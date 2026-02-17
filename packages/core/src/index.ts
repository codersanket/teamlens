export * from './types.js';
export { MemoryDatabase } from './store/database.js';
export { EmbeddingProvider } from './store/embeddings.js';
export { GitExtractor } from './extractor/git-extractor.js';
export { StalenessEngine } from './staleness/staleness-engine.js';
export { MemoryRetriever } from './retrieval/retriever.js';
export { TeamSync } from './sync/team-sync.js';
export { Distributor } from './distribution/distributor.js';
export { SessionManager } from './session/session-manager.js';
export { InsightDetector } from './session/insight-detector.js';
export { AnalyticsEngine } from './analytics/analytics-engine.js';

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type {
  TeamLensConfig,
  ExtractedMemory,
  MemoryCategory,
  MemoryTier,
  RulePriority,
  DistributionTarget,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { MemoryDatabase } from './store/database.js';
import { EmbeddingProvider } from './store/embeddings.js';
import { GitExtractor } from './extractor/git-extractor.js';
import { StalenessEngine } from './staleness/staleness-engine.js';
import { MemoryRetriever } from './retrieval/retriever.js';
import { TeamSync } from './sync/team-sync.js';
import { Distributor } from './distribution/distributor.js';
import { SessionManager } from './session/session-manager.js';
import { AnalyticsEngine } from './analytics/analytics-engine.js';

/**
 * TeamLens — the main entry point.
 *
 * Wires together the database, extractor, staleness engine, retriever,
 * team sync, distributor, session manager, and analytics engine.
 *
 * Use the async factory: `const tl = await TeamLens.create(repoPath)`
 */
export class TeamLens {
  readonly db: MemoryDatabase;
  readonly git: GitExtractor;
  readonly staleness: StalenessEngine;
  readonly retriever: MemoryRetriever;
  readonly embeddings: EmbeddingProvider;
  readonly team: TeamSync;
  readonly distributor: Distributor;
  readonly sessions: SessionManager;
  readonly analytics: AnalyticsEngine;
  readonly config: TeamLensConfig;
  readonly repoPath: string;

  private constructor(
    repoPath: string,
    db: MemoryDatabase,
    config: TeamLensConfig
  ) {
    this.repoPath = repoPath;
    this.config = config;
    this.db = db;

    const storageDir = path.resolve(repoPath, config.storageDir);

    this.embeddings = new EmbeddingProvider(this.config);
    this.git = new GitExtractor(repoPath);
    this.staleness = new StalenessEngine(this.db, this.git);
    this.retriever = new MemoryRetriever(this.db, this.embeddings, this.config);
    this.team = new TeamSync(this.db, storageDir, repoPath);
    this.distributor = new Distributor(this.db, repoPath);
    this.sessions = new SessionManager(this.db, this.config, this.team, this.embeddings);
    this.analytics = new AnalyticsEngine(this.db);
  }

  /** Async factory — required because sql.js needs async initialization. */
  static async create(repoPath: string, userConfig?: Partial<TeamLensConfig>): Promise<TeamLens> {
    const config = { ...DEFAULT_CONFIG, ...userConfig };

    // Auto-detect git author if not set
    if (config.author === 'unknown') {
      config.author = TeamLens.detectGitAuthor(repoPath);
    }

    // Developer defaults to author
    if (config.developer === 'unknown') {
      config.developer = config.author;
    }

    // Storage dir migration: prefer .teamlens, fallback to .codememory
    const teamlensDir = path.resolve(repoPath, '.teamlens');
    const codememoryDir = path.resolve(repoPath, '.codememory');

    if (!fs.existsSync(teamlensDir) && fs.existsSync(codememoryDir)) {
      // Migrate: rename .codememory to .teamlens
      fs.renameSync(codememoryDir, teamlensDir);
      config.storageDir = '.teamlens';
    }

    const storageDir = path.resolve(repoPath, config.storageDir);
    const db = await MemoryDatabase.create(storageDir);

    return new TeamLens(repoPath, db, config);
  }

  // ── Init ──

  /** Scan the repo and build initial memory from git history. */
  async init(options?: { extractFromGit?: boolean }): Promise<{ memoriesCreated: number; filesTracked: number; teamImported: number }> {
    const extractFromGit = options?.extractFromGit ?? true;
    let memoriesCreated = 0;

    // Ensure .gitignore has memory.db
    this.ensureGitignore();

    // Import any existing team memories from team.jsonl
    const teamImported = this.team.importFromShared();

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

    // Extract memories from recent commits (last 90 days) — only if opted in
    if (extractFromGit) {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const commits = await this.git.getRecentCommits(since);

      for (const commit of commits) {
        commit.files = await this.git.getCommitFiles(commit.sha);
        this.db.upsertCommit(commit);

        const memories = await this.git.extractFromCommit(commit);
        for (const mem of memories) {
          this.db.insertMemory(mem, commit.author, 'team');
          memoriesCreated++;
        }
        this.db.markCommitProcessed(commit.sha);
      }

      // Export git-extracted team memories to team.jsonl
      if (memoriesCreated > 0) {
        this.team.exportToShared();
      }

      // Generate embeddings for all memories
      await this.embedAllMemories();
    }

    const filesTracked = files.filter((f) => !ignoreMatcher(f)).length;
    return { memoriesCreated, filesTracked, teamImported };
  }

  // ── Remember ──

  /** Agent or user stores a new memory (personal by default). */
  async remember(
    content: string,
    category: ExtractedMemory['category'],
    relatedFiles: string[] = [],
    tags: string[] = [],
    tier: MemoryTier = 'personal'
  ): Promise<string> {
    const memory = this.db.insertMemory(
      { content, category, relatedFiles, tags, confidence: 0.9, commitSha: null },
      this.config.author,
      tier
    );

    // Generate embedding
    const embedding = await this.embeddings.embed(content);
    if (embedding) {
      this.db.updateEmbedding(memory.id, embedding);
    }

    // If team tier, also write to team.jsonl
    if (tier === 'team') {
      this.team.exportToShared();
    }

    return memory.id;
  }

  // ── Rules (Governance) ──

  /** Add a team rule — stored as source='rule', tier='team', confidence=1.0. */
  async addRule(
    content: string,
    category: MemoryCategory,
    options?: {
      scope?: string[];
      priority?: RulePriority;
      good?: string;
      bad?: string;
    }
  ): Promise<string> {
    const memory = this.db.insertMemory(
      { content, category, relatedFiles: [], tags: [], confidence: 1.0, commitSha: null },
      this.config.author,
      'team'
    );

    // Set rule-specific fields
    const examples = (options?.good || options?.bad)
      ? { good: options?.good, bad: options?.bad }
      : null;

    this.db.updateRuleFields(memory.id, {
      source: 'rule',
      scope: options?.scope ?? null,
      priority: options?.priority ?? 'normal',
      examples,
    });

    // Export to team.jsonl
    this.team.exportToShared();

    return memory.id;
  }

  /** Distribute rules to agent config files. */
  distribute(targets?: DistributionTarget[]): { generated: string[]; warnings: string[] } {
    return this.distributor.distribute(targets);
  }

  // ── Team ──

  /** Promote a personal memory to team (shared with everyone). */
  share(memoryId: string): { success: boolean; error?: string } {
    return this.team.share(memoryId);
  }

  /** Import new team memories from team.jsonl (call after git pull). */
  syncTeam(): number {
    const imported = this.team.importFromShared();
    return imported;
  }

  /** Get memories by a specific team member. */
  getByAuthor(author: string) {
    return this.db.getMemoriesByAuthor(author);
  }

  /** Get all team authors and their memory counts. */
  getTeamAuthors() {
    return this.db.getTeamAuthors();
  }

  /** Find who on the team has context about a topic. */
  async whoKnows(query: string): Promise<{ author: string; memories: number; topMemory: string }[]> {
    const results = await this.retriever.query({ query, limit: 50 });
    const teamResults = results.filter((r) => r.memory.tier === 'team');

    // Group by author
    const authorMap = new Map<string, { count: number; topMemory: string; topScore: number }>();
    for (const r of teamResults) {
      const existing = authorMap.get(r.memory.author);
      if (!existing || r.score > existing.topScore) {
        authorMap.set(r.memory.author, {
          count: (existing?.count ?? 0) + 1,
          topMemory: r.memory.content,
          topScore: r.score,
        });
      } else {
        existing.count++;
      }
    }

    return Array.from(authorMap.entries())
      .map(([author, data]) => ({
        author,
        memories: data.count,
        topMemory: data.topMemory,
      }))
      .sort((a, b) => b.memories - a.memories);
  }

  // ── Process New Commits ──

  /** Process any unprocessed commits and update staleness. */
  async processNewCommits(): Promise<{ newMemories: number; stalenessUpdates: number; teamImported: number }> {
    // First, import any team memories from team.jsonl (teammate may have pushed)
    const teamImported = this.team.importFromShared();

    const unprocessed = this.db.getUnprocessedCommits();
    let newMemories = 0;

    for (const commit of unprocessed) {
      commit.files = await this.git.getCommitFiles(commit.sha);

      const memories = await this.git.extractFromCommit(commit);
      for (const mem of memories) {
        this.db.insertMemory(mem, commit.author, 'team');
        newMemories++;
      }
      this.db.markCommitProcessed(commit.sha);
    }

    // Check staleness for files changed in these commits
    const changedFiles = unprocessed.flatMap((c) => c.files);
    const uniqueFiles = [...new Set(changedFiles)];
    const checks = await this.staleness.processChangedFiles(uniqueFiles);

    // Export updated team memories
    if (newMemories > 0) {
      this.team.exportToShared();
    }

    // Embed new memories
    await this.embedAllMemories();

    return { newMemories, stalenessUpdates: checks.length, teamImported };
  }

  // ── Query ──

  /** Query memories with multi-signal ranking. */
  async query(queryText: string, scope?: string, limit?: number, tier?: MemoryTier) {
    return this.retriever.query({ query: queryText, scope, limit, tier });
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

  confirm(memoryId: string): void {
    this.db.validateMemory(memoryId);
  }

  markStale(memoryId: string): void {
    this.db.updateStaleness(memoryId, 1.0);
  }

  forget(memoryId: string): void {
    this.db.deleteMemory(memoryId);
  }

  stats() {
    return this.db.getMemoryCount();
  }

  close(): void {
    this.db.close();
  }

  // ── Private ──

  private static detectGitAuthor(repoPath: string): string {
    try {
      return execSync('git config user.name', { cwd: repoPath, encoding: 'utf-8' }).trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Ensure .teamlens/memory.db is gitignored but team.jsonl is NOT. */
  private ensureGitignore(): void {
    const gitignorePath = path.join(this.repoPath, this.config.storageDir, '.gitignore');
    const content = '# Local database — gitignored (team sync uses team.jsonl)\nmemory.db\nmemory.db-wal\nmemory.db-shm\n';

    if (!fs.existsSync(gitignorePath)) {
      fs.mkdirSync(path.dirname(gitignorePath), { recursive: true });
      fs.writeFileSync(gitignorePath, content);
    }
  }

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

/** @deprecated Use TeamLens instead */
export const CodeMemory = TeamLens;
