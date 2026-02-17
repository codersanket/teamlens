// ── Memory Categories ──

export type MemoryCategory =
  | 'architecture'
  | 'convention'
  | 'decision'
  | 'correction'
  | 'active_context'
  | 'discovery'
  | 'gotcha'
  | 'dependency';

export type MemorySource = 'git' | 'agent' | 'manual' | 'rule' | 'session';

export type MemoryTier = 'personal' | 'team';

export type RulePriority = 'critical' | 'high' | 'normal' | 'low';

export type DistributionTarget = 'claude' | 'cursor' | 'copilot' | 'agents_md';

export type InsightType =
  | 'gotcha'
  | 'convention'
  | 'architecture'
  | 'dependency'
  | 'decision'
  | 'correction'
  | 'discovery';

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export type ActivityType =
  | 'debug'
  | 'refactor'
  | 'file_edit'
  | 'review'
  | 'test'
  | 'research'
  | 'implementation'
  | 'other';

// ── Core Types ──

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  /** personal = local only, team = synced via team.jsonl */
  tier: MemoryTier;
  /** Who created this memory (git username or "agent") */
  author: string;
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
  /** Glob patterns this rule applies to (null = global rule) */
  scope: string[] | null;
  /** Ordering priority in generated configs (null = 'normal') */
  priority: RulePriority | null;
  /** Code examples for this rule */
  examples: { good?: string; bad?: string } | null;
  /** Whether this rule is active (inactive rules are hidden but not deleted) */
  active: boolean;
  /** Session ID that produced this memory (null if not from a session) */
  sessionId: string | null;
  /** Number of times this insight was reused by other sessions */
  reuseCount: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string;
}

/** A single line in team.jsonl — the git-synced team memory format. */
export interface SharedMemoryEntry {
  id: string;
  content: string;
  category: MemoryCategory;
  source: MemorySource;
  author: string;
  tags: string[];
  relatedFiles: string[];
  commitSha: string | null;
  confidence: number;
  scope?: string[] | null;
  priority?: RulePriority | null;
  examples?: { good?: string; bad?: string } | null;
  active?: boolean;
  createdAt: string;
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

// ── Session Types ──

export interface Session {
  id: string;
  developer: string;
  task: string;
  status: SessionStatus;
  toolName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  filesTouched: string[];
  summary: string | null;
  insightCount: number;
  activityCount: number;
  duplicatesPrevented: number;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  type: ActivityType;
  description: string;
  files: string[];
  timestamp: string;
}

// ── Analytics Types ──

export interface DeveloperStats {
  developer: string;
  totalSessions: number;
  totalInsights: number;
  avgSessionDuration: number;
  insightsPerSession: number;
  knowledgeReused: number;
  lastActive: string | null;
}

export interface ContributorEntry {
  rank: number;
  developer: string;
  insightsShared: number;
  knowledgeReused: number;
  impactScore: number;
}

export interface ROIMetrics {
  duplicatesPrevented: number;
  knowledgeReuseCount: number;
  estimatedHoursSaved: number;
  insightsPerAIHour: number;
  teamKnowledgeCoverage: number;
}

export interface UsageTrend {
  date: string;
  sessions: number;
  insights: number;
  activeDevelopers: number;
}

export interface HotFile {
  filePath: string;
  insightCount: number;
  lastInsight: string;
}

export interface TeamAnalytics {
  overview: {
    totalSessions: number;
    totalInsights: number;
    activeDevelopers: number;
    avgInsightsPerSession: number;
  };
  roi: ROIMetrics;
  trends: UsageTrend[];
  contributors: ContributorEntry[];
  hotFiles: HotFile[];
  insightsByType: Record<string, number>;
}

// ── Retrieval ──

export interface RetrievalQuery {
  query: string;
  /** Narrow results to memories about files in this directory */
  scope?: string;
  /** Filter by category */
  category?: MemoryCategory;
  /** Filter by tier */
  tier?: MemoryTier;
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

export interface TeamLensConfig {
  /** Directory to store memory data (default: .teamlens) */
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
  /** Author name for memories (default: git user.name or "unknown") */
  author: string;
  /** Enable session tracking (default: true) */
  sessionTracking: boolean;
  /** Auto-close sessions after N minutes of inactivity (default: 60) */
  sessionTimeoutMinutes: number;
  /** Developer name for sessions (defaults to author) */
  developer: string;
  /** Port for the web dashboard (default: 3847) */
  webPort: number;
}

/** @deprecated Use TeamLensConfig instead */
export type CodeMemoryConfig = TeamLensConfig;

export const DEFAULT_CONFIG: TeamLensConfig = {
  storageDir: '.teamlens',
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
  ],
  author: 'unknown',
  sessionTracking: true,
  sessionTimeoutMinutes: 60,
  developer: 'unknown',
  webPort: 3847,
};
