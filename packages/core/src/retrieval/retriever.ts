import type { MemoryDatabase } from '../store/database.js';
import { EmbeddingProvider } from '../store/embeddings.js';
import type {
  RetrievalQuery,
  ScoredMemory,
  Memory,
  CodeMemoryConfig,
} from '../types.js';

/**
 * Multi-signal retriever — ranks memories using:
 *   0.40 × semantic similarity  (embedding cosine)
 *   0.25 × file proximity       (same directory as scope)
 *   0.20 × recency              (newer = higher)
 *   0.15 × confidence           (author confidence score)
 *   – staleness penalty          (stale memories pushed down)
 *
 * Falls back to keyword matching when embeddings aren't available.
 */
export class MemoryRetriever {
  constructor(
    private db: MemoryDatabase,
    private embeddings: EmbeddingProvider,
    private config: CodeMemoryConfig
  ) {}

  async query(request: RetrievalQuery): Promise<ScoredMemory[]> {
    const limit = request.limit ?? this.config.defaultLimit;
    const includeStale = request.includeStale ?? false;

    // Get candidate memories
    let candidates = request.category
      ? this.db.getMemoriesByCategory(request.category)
      : this.db.getAllMemories(includeStale);

    // Filter by scope (directory prefix)
    if (request.scope) {
      candidates = candidates.filter((m) =>
        m.relatedFiles.some((f) => f.startsWith(request.scope!))
      );
    }

    if (candidates.length === 0) return [];

    // Try to get query embedding for semantic scoring
    const queryEmbedding = await this.embeddings.embed(request.query);

    // Score each candidate
    const scored: ScoredMemory[] = candidates.map((memory) => {
      const semantic = this.scoreSemantic(memory, request.query, queryEmbedding);
      const fileProximity = this.scoreFileProximity(memory, request.scope);
      const recency = this.scoreRecency(memory);
      const confidence = memory.confidence;
      const stalenessPenalty = memory.staleness * 0.5;

      const score =
        0.4 * semantic +
        0.25 * fileProximity +
        0.2 * recency +
        0.15 * confidence -
        stalenessPenalty;

      return {
        memory,
        score,
        breakdown: {
          semantic,
          fileProximity,
          recency,
          confidence,
          stalenessPenalty,
        },
      };
    });

    // Sort by score descending, return top-K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Convenience: get all conventions (no query needed). */
  async getConventions(): Promise<Memory[]> {
    return this.db.getMemoriesByCategory('convention');
  }

  /** Convenience: get decisions for a scope. */
  async getDecisions(scope?: string): Promise<Memory[]> {
    const decisions = this.db.getMemoriesByCategory('decision');
    if (!scope) return decisions;
    return decisions.filter((m) =>
      m.relatedFiles.some((f) => f.startsWith(scope))
    );
  }

  // ── Scoring Functions ──

  private scoreSemantic(memory: Memory, query: string, queryEmbedding: number[] | null): number {
    // If we have embeddings for both, use cosine similarity
    if (queryEmbedding && memory.embedding) {
      return EmbeddingProvider.cosineSimilarity(queryEmbedding, memory.embedding);
    }

    // Fallback: keyword matching
    return this.keywordScore(memory.content, query);
  }

  private scoreFileProximity(memory: Memory, scope?: string): number {
    if (!scope) return 0.5; // Neutral when no scope

    const matches = memory.relatedFiles.filter((f) => f.startsWith(scope)).length;
    const total = memory.relatedFiles.length;

    if (total === 0) return 0.3;
    return Math.min(matches / total, 1.0);
  }

  private scoreRecency(memory: Memory): number {
    const ageMs = Date.now() - new Date(memory.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Exponential decay: half-life of 30 days
    return Math.exp(-ageDays / 30);
  }

  /**
   * Simple keyword overlap score when embeddings aren't available.
   * Counts how many query words appear in the content.
   */
  private keywordScore(content: string, query: string): number {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const contentLower = content.toLowerCase();

    if (queryWords.length === 0) return 0;

    const matches = queryWords.filter((w) => contentLower.includes(w)).length;
    return matches / queryWords.length;
  }
}
