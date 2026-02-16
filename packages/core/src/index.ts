export * from './types.js';
export { MemoryDatabase } from './store/database.js';
export { EmbeddingProvider } from './store/embeddings.js';
export { GitExtractor } from './extractor/git-extractor.js';
export { StalenessEngine } from './staleness/staleness-engine.js';
export { MemoryRetriever } from './retrieval/retriever.js';

import path from 'node:path';
import type { CodeMemoryConfig, ExtractedMemory } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { MemoryDatabase } from './store/database.js';
import { EmbeddingProvider } from './store/embeddings.js';
import { GitExtractor } from './extractor/git-extractor.js';
import { StalenessEngine } from './staleness/staleness-engine.js';
import { MemoryRetriever } from './retrieval/retriever.js';

/**
 * CodeMemory — the main entry point.
 *
 * Wires together the database, extractor, staleness engine, and retriever.
 */
export class CodeMemory {
  readonly db: MemoryDatabase;
  readonly git: GitExtractor;
  readonly staleness: StalenessEngine;
  readonly retriever: MemoryRetriever;
  readonly embeddings: EmbeddingProvider;
  readonly config: CodeMemoryConfig;

  constructor(repoPath: string, userConfig?: Partial<CodeMemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    const storageDir = path.resolve(repoPath, this.config.storageDir);

    this.db = new MemoryDatabase(storageDir);
    this.embeddings = new EmbeddingProvider(this.config);
    this.git = new GitExtractor(repoPath);
    this.staleness = new StalenessEngine(this.db, this.git);
    this.retriever = new MemoryRetriever(this.db, this.embeddings, this.config);
  }

  // ── Init ──

  /** Scan the repo and build initial memory from git history. */
  async init(): Promise<{ memoriesCreated: number; filesTracked: number }> {
    let memoriesCreated = 0;

    // Track all current files
    const files = await this.git.getTrackedFiles();
    const ignoreMatcher = this.buildIgnoreMatcher();

    for (const file of files) {
      if (ignoreMatcher(file)) continue;
      const hash = await this.git.getFileHash(file);
      if (hash) {
        this.db.upsertTrackedFile({
          path: file,
          hash,
          lastModified: new Date().toISOString(),
        });
      }
    }

    // Extract memories from recent commits (last 90 days)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const commits = await this.git.getRecentCommits(since);

    for (const commit of commits) {
      commit.files = await this.git.getCommitFiles(commit.sha);
      this.db.upsertCommit(commit);

      const memories = await this.git.extractFromCommit(commit);
      for (const mem of memories) {
        this.db.insertMemory(mem);
        memoriesCreated++;
      }
      this.db.markCommitProcessed(commit.sha);
    }

    // Generate embeddings for all memories
    await this.embedAllMemories();

    const filesTracked = files.filter((f) => !ignoreMatcher(f)).length;
    return { memoriesCreated, filesTracked };
  }

  // ── Remember ──

  /** Agent or user stores a new memory. */
  async remember(
    content: string,
    category: ExtractedMemory['category'],
    relatedFiles: string[] = [],
    tags: string[] = []
  ): Promise<string> {
    const memory = this.db.insertMemory({
      content,
      category,
      relatedFiles,
      tags,
      confidence: 0.9,
      commitSha: null,
    });

    // Generate embedding
    const embedding = await this.embeddings.embed(content);
    if (embedding) {
      this.db.updateEmbedding(memory.id, embedding);
    }

    return memory.id;
  }

  // ── Process New Commits ──

  /** Process any unprocessed commits and update staleness. */
  async processNewCommits(): Promise<{ newMemories: number; stalenessUpdates: number }> {
    const unprocessed = this.db.getUnprocessedCommits();
    let newMemories = 0;

    for (const commit of unprocessed) {
      commit.files = await this.git.getCommitFiles(commit.sha);

      const memories = await this.git.extractFromCommit(commit);
      for (const mem of memories) {
        this.db.insertMemory(mem);
        newMemories++;
      }
      this.db.markCommitProcessed(commit.sha);
    }

    // Check staleness for files changed in these commits
    const changedFiles = unprocessed.flatMap((c) => c.files);
    const uniqueFiles = [...new Set(changedFiles)];
    const checks = await this.staleness.processChangedFiles(uniqueFiles);

    // Embed new memories
    await this.embedAllMemories();

    return { newMemories, stalenessUpdates: checks.length };
  }

  // ── Query ──

  /** Query memories with multi-signal ranking. */
  async query(queryText: string, scope?: string, limit?: number) {
    return this.retriever.query({ query: queryText, scope, limit });
  }

  /** Get all conventions. */
  async getConventions() {
    return this.retriever.getConventions();
  }

  /** Get decisions for a scope. */
  async getDecisions(scope?: string) {
    return this.retriever.getDecisions(scope);
  }

  // ── Memory Management ──

  /** Mark a memory as confirmed valid. */
  confirm(memoryId: string): void {
    this.db.validateMemory(memoryId);
  }

  /** Mark a memory as stale. */
  markStale(memoryId: string): void {
    this.db.updateStaleness(memoryId, 1.0);
  }

  /** Delete a memory. */
  forget(memoryId: string): void {
    this.db.deleteMemory(memoryId);
  }

  /** Get memory stats. */
  stats() {
    return this.db.getMemoryCount();
  }

  // ── Cleanup ──

  close(): void {
    this.db.close();
  }

  // ── Private ──

  private async embedAllMemories(): Promise<void> {
    if (!(await this.embeddings.isAvailable())) return;

    const memories = this.db.getAllMemories(true);
    for (const mem of memories) {
      if (mem.embedding) continue;
      const embedding = await this.embeddings.embed(mem.content);
      if (embedding) {
        this.db.updateEmbedding(mem.id, embedding);
      }
    }
  }

  private buildIgnoreMatcher(): (filePath: string) => boolean {
    const patterns = this.config.ignorePatterns.map((p) => {
      const regex = p
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      return new RegExp(`^${regex}$`);
    });

    return (filePath: string) => patterns.some((r) => r.test(filePath));
  }
}
