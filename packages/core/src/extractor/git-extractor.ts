import simpleGit, { type SimpleGit, type DiffResult } from 'simple-git';
import type { ExtractedMemory, TrackedCommit, MemoryCategory } from '../types.js';

/**
 * Extracts memories from git history — commits, diffs, and file changes.
 *
 * Uses heuristic pattern matching (no LLM required).
 * Detects architectural decisions, migrations, refactors, and conventions
 * from commit messages and diff patterns.
 */
export class GitExtractor {
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  /** Get recent commits not yet tracked. */
  async getRecentCommits(since?: string): Promise<TrackedCommit[]> {
    const options: Record<string, string | null> = { '--no-merges': null };
    if (since) options['--since'] = since;

    const log = await this.git.log(options);

    return log.all.map((entry) => ({
      sha: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      files: [],
      processed: false,
    }));
  }

  /** Get files changed in a specific commit. */
  async getCommitFiles(sha: string): Promise<string[]> {
    try {
      const result = await this.git.raw(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
      return result.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Get the diff stat for a specific file in a commit. */
  async getFileDiffStat(sha: string, filePath: string): Promise<{ insertions: number; deletions: number } | null> {
    try {
      const diff = await this.git.diffSummary([`${sha}^`, sha, '--', filePath]);
      const file = diff.files[0];
      if (!file || file.binary) return null;
      return { insertions: file.insertions, deletions: file.deletions };
    } catch {
      return null;
    }
  }

  /** Extract memories from a single commit. */
  async extractFromCommit(commit: TrackedCommit): Promise<ExtractedMemory[]> {
    const memories: ExtractedMemory[] = [];
    const files = await this.getCommitFiles(commit.sha);
    const message = commit.message.toLowerCase();

    // Detect architectural decisions
    if (this.isArchitecturalCommit(message)) {
      memories.push({
        content: `Architecture change: ${commit.message}`,
        category: 'architecture',
        relatedFiles: files,
        tags: this.extractTags(message),
        confidence: 0.7,
        commitSha: commit.sha,
      });
    }

    // Detect migrations / breaking changes
    if (this.isMigrationCommit(message)) {
      memories.push({
        content: `Migration: ${commit.message}`,
        category: 'active_context',
        relatedFiles: files,
        tags: ['migration', ...this.extractTags(message)],
        confidence: 0.8,
        commitSha: commit.sha,
      });
    }

    // Detect convention-setting commits
    if (this.isConventionCommit(message)) {
      memories.push({
        content: `Convention: ${commit.message}`,
        category: 'convention',
        relatedFiles: files,
        tags: ['convention', ...this.extractTags(message)],
        confidence: 0.6,
        commitSha: commit.sha,
      });
    }

    // Detect decisions from commit messages with "because", "instead of", "chose"
    const decision = this.extractDecision(commit.message);
    if (decision) {
      memories.push({
        content: decision,
        category: 'decision',
        relatedFiles: files,
        tags: this.extractTags(message),
        confidence: 0.75,
        commitSha: commit.sha,
      });
    }

    // Large commits that touch many files → likely refactor
    if (files.length > 10) {
      memories.push({
        content: `Large refactor (${files.length} files): ${commit.message}`,
        category: 'architecture',
        relatedFiles: files.slice(0, 20),
        tags: ['refactor', ...this.extractTags(message)],
        confidence: 0.5,
        commitSha: commit.sha,
      });
    }

    return memories;
  }

  /** Get current file hash for staleness tracking. */
  async getFileHash(filePath: string): Promise<string | null> {
    try {
      const result = await this.git.raw(['hash-object', filePath]);
      return result.trim();
    } catch {
      return null;
    }
  }

  /** Get all tracked files in the repo. */
  async getTrackedFiles(): Promise<string[]> {
    const result = await this.git.raw(['ls-files']);
    return result.split('\n').filter(Boolean);
  }

  /** Get diff summary between HEAD and a previous state. */
  async getDiffSummary(fromRef: string, toRef = 'HEAD'): Promise<DiffResult> {
    return this.git.diffSummary([fromRef, toRef]);
  }

  // ── Pattern Matchers ──

  private isArchitecturalCommit(message: string): boolean {
    const patterns = [
      /\b(architect|restructur|reorganiz|overhaul|rewrite|redesign)\b/,
      /\b(add|create|setup|init).*(module|service|layer|system|engine|framework)\b/,
      /\b(move|split|extract|decouple).*(into|from|to)\b/,
    ];
    return patterns.some((p) => p.test(message));
  }

  private isMigrationCommit(message: string): boolean {
    const patterns = [
      /\b(migrat|upgrade|downgrade|breaking)\b/,
      /\b(switch|move|convert).*(from|to)\b/,
      /\b(deprecat|replac|swap)\b/,
    ];
    return patterns.some((p) => p.test(message));
  }

  private isConventionCommit(message: string): boolean {
    const patterns = [
      /\b(lint|format|style|convention|standard)\b/,
      /\b(enforce|require|configure).*(rule|pattern|style)\b/,
      /\b(eslint|prettier|editorconfig)\b/,
    ];
    return patterns.some((p) => p.test(message));
  }

  private extractDecision(message: string): string | null {
    const patterns = [
      /\bbecause\s+(.+)/i,
      /\binstead of\s+(.+)/i,
      /\bchose\s+(.+)/i,
      /\breason:\s*(.+)/i,
      /\bwhy:\s*(.+)/i,
    ];

    for (const p of patterns) {
      const match = message.match(p);
      if (match) return `Decision: ${message}`;
    }
    return null;
  }

  private extractTags(message: string): string[] {
    const tags: string[] = [];
    const keywords: Record<string, string> = {
      auth: 'auth',
      api: 'api',
      database: 'database',
      db: 'database',
      ui: 'ui',
      test: 'testing',
      ci: 'ci-cd',
      deploy: 'deployment',
      security: 'security',
      performance: 'performance',
      perf: 'performance',
      config: 'config',
      docs: 'documentation',
    };

    for (const [keyword, tag] of Object.entries(keywords)) {
      if (message.includes(keyword)) tags.push(tag);
    }

    return [...new Set(tags)];
  }
}
