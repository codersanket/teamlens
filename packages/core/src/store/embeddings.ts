import type { CodeMemoryConfig } from '../types.js';

/**
 * Embedding provider — generates vector embeddings for memory content.
 *
 * Uses Ollama locally by default (free, private, offline).
 * Falls back to no embeddings if Ollama isn't available (retrieval
 * uses keyword matching instead).
 */
export class EmbeddingProvider {
  private model: string;
  private host: string;
  private available: boolean | null = null;

  constructor(config: CodeMemoryConfig) {
    this.model = config.embeddingModel;
    this.host = config.ollamaHost;
  }

  /** Check if Ollama is reachable and the model is available. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        this.available = false;
        return false;
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      this.available = data.models?.some((m) => m.name.startsWith(this.model)) ?? false;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /** Generate an embedding vector for the given text. Returns null if unavailable. */
  async embed(text: string): Promise<number[] | null> {
    if (!(await this.isAvailable())) return null;

    try {
      const res = await fetch(`${this.host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as { embeddings?: number[][] };
      return data.embeddings?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Compute cosine similarity between two vectors. */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
