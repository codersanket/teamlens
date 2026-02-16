// ── Memory Categories ──

export type MemoryCategory =
  | 'architecture'
  | 'convention'
  | 'decision'
  | 'correction'
  | 'active_context';

export type MemorySource = 'git' | 'agent' | 'manual';

// ── Core Types ──

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  tags: string[];
  /** File paths this memory is about */
  relatedFiles: string[];
  /** Commit SHA that produced this memory (if git-sourced) */
  commitSha: string | null;
  /** 0.0 = fresh, 1.0 = fully stale */
  staleness: number;
  /** How confident we are in this memory (0.0–1.0) */
  confidence: number;
  /** Embedding vector (null until computed) */
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
  validatedAt: string;
}

export interface TrackedFile {
  path: string;
  /** Last known git hash of this file */
  hash: string;
  lastModified: string;
}

export interface TrackedCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  /** Files touched in this commit */
  files: string[];
  /** Whether we already extracted memories from this commit */
  processed: boolean;
}

// ── Retrieval ──

export interface RetrievalQuery {
  query: string;
  /** Narrow results to memories about files in this directory */
  scope?: string;
  /** Filter by category */
  category?: MemoryCategory;
  /** Max results to return */
  limit?: number;
  /** Include stale memories (default: false) */
  includeStale?: boolean;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  /** Breakdown of how the score was computed */
  breakdown: {
    semantic: number;
    fileProximity: number;
    recency: number;
    confidence: number;
    stalenessPenalty: number;
  };
}

// ── Staleness ──

export interface StalenessCheck {
  memoryId: string;
  reason: 'file_deleted' | 'file_renamed' | 'minor_edit' | 'major_refactor' | 'function_removed';
  oldStaleness: number;
  newStaleness: number;
  changedFile: string;
}

// ── Extraction ──

export interface ExtractedMemory {
  content: string;
  category: MemoryCategory;
  relatedFiles: string[];
  tags: string[];
  confidence: number;
  commitSha: string | null;
}

// ── Config ──

export interface CodeMemoryConfig {
  /** Directory to store memory data (default: .codememory) */
  storageDir: string;
  /** Enable local embeddings via Ollama (default: true) */
  localEmbeddings: boolean;
  /** Ollama model for embeddings (default: nomic-embed-text) */
  embeddingModel: string;
  /** Ollama host (default: http://localhost:11434) */
  ollamaHost: string;
  /** Staleness threshold to auto-flag (default: 0.6) */
  stalenessThreshold: number;
  /** Max memories to return per query (default: 10) */
  defaultLimit: number;
  /** File patterns to ignore (default: node_modules, dist, etc.) */
  ignorePatterns: string[];
}

export const DEFAULT_CONFIG: CodeMemoryConfig = {
  storageDir: '.codememory',
  localEmbeddings: true,
  embeddingModel: 'nomic-embed-text',
  ollamaHost: 'http://localhost:11434',
  stalenessThreshold: 0.6,
  defaultLimit: 10,
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    '*.lock',
    '*.min.js',
    '*.min.css',
    'coverage/**',
    '.codememory/**',
  ],
};
