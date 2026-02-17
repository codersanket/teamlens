import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { MemoryDatabase } from '../store/database.js';
import type { SharedMemoryEntry, Memory, RulePriority } from '../types.js';

/**
 * Team Sync Engine — syncs team memories via team.jsonl in git.
 *
 * Architecture:
 *   .teamlens/
 *   ├── memory.db       ← local SQLite (gitignored) — all memories
 *   └── team.jsonl      ← team memories (committed to git) — sync file
 *
 * Flow:
 *   share(id)   → promote personal → team, append to team.jsonl
 *   sync()      → read team.jsonl, import new team memories into memory.db
 *   export()    → write all team memories to team.jsonl (rebuild)
 *
 * JSONL format: one JSON object per line, each line is a SharedMemoryEntry.
 * Git-friendly: append-only, readable diffs, git blame shows who added what.
 *
 * Migration: auto-renames shared.jsonl → team.jsonl on first access.
 */
export class TeamSync {
  private teamPath: string;
  private legacyPath: string;
  private repoPath: string;

  constructor(
    private db: MemoryDatabase,
    storageDir: string,
    repoPath?: string
  ) {
    this.teamPath = path.join(storageDir, 'team.jsonl');
    this.legacyPath = path.join(storageDir, 'shared.jsonl');
    this.repoPath = repoPath ?? path.resolve(storageDir, '..');

    // Auto-migrate shared.jsonl → team.jsonl
    this.migrateIfNeeded();
  }

  /** Path to the team.jsonl file. */
  get filePath(): string {
    return this.teamPath;
  }

  /**
   * Promote a personal memory to team.
   * Updates tier in DB and appends to team.jsonl.
   */
  share(memoryId: string): { success: boolean; error?: string } {
    const memory = this.db.getMemory(memoryId);
    if (!memory) return { success: false, error: 'Memory not found' };
    if (memory.tier === 'team') return { success: false, error: 'Already shared with team' };

    // Update tier in database
    this.db.updateTier(memoryId, 'team');

    // Append to team.jsonl
    const entry = this.memoryToEntry(memory);
    this.appendEntry(entry);

    return { success: true };
  }

  /**
   * Import new team memories from team.jsonl into local memory.db.
   * Called after git pull to pick up teammates' memories.
   * Returns count of new memories imported.
   */
  importFromShared(): number {
    if (!fs.existsSync(this.teamPath)) return 0;

    const entries = this.readSharedFile();
    let imported = 0;

    for (const entry of entries) {
      // Skip if we already have this memory
      if (this.db.hasMemory(entry.id)) continue;

      this.db.insertTeamMemory({
        id: entry.id,
        content: entry.content,
        category: entry.category,
        source: entry.source,
        tier: 'team',
        author: entry.author,
        tags: entry.tags,
        relatedFiles: entry.relatedFiles,
        commitSha: entry.commitSha,
        confidence: entry.confidence,
        scope: entry.scope ?? null,
        priority: (entry.priority as RulePriority) ?? null,
        examples: entry.examples ?? null,
        active: entry.active ?? true,
        createdAt: entry.createdAt,
      });

      imported++;
    }

    return imported;
  }

  /**
   * Rebuild team.jsonl from all team memories in the database.
   * Used to fix sync issues or initialize shared file.
   */
  exportToShared(): number {
    const teamMemories = this.db.getMemoriesByTier('team', true);
    const entries = teamMemories.map(this.memoryToEntry);

    // Write all at once (overwrite)
    const content = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(this.teamPath, content ? content + '\n' : '');

    return entries.length;
  }

  /** Get count of team memories in team.jsonl. */
  sharedCount(): number {
    if (!fs.existsSync(this.teamPath)) return 0;
    return this.readSharedFile().length;
  }

  /** Get all entries from team.jsonl. */
  readSharedFile(): SharedMemoryEntry[] {
    if (!fs.existsSync(this.teamPath)) return [];

    const content = fs.readFileSync(this.teamPath, 'utf-8').trim();
    if (!content) return [];

    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as SharedMemoryEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SharedMemoryEntry => entry !== null);
  }

  /** Append a single memory to team.jsonl without rewriting the entire file. */
  appendMemory(memory: Memory): void {
    const entry = this.memoryToEntry(memory);
    this.appendEntry(entry);
  }

  /**
   * Auto-commit and push team.jsonl to git.
   * Called after sharing an insight so teammates get it on next pull.
   * Non-fatal — silently fails if not in a git repo or push fails.
   */
  autoCommitAndPush(): { committed: boolean; pushed: boolean } {
    const relativePath = path.relative(this.repoPath, this.teamPath);
    let committed = false;
    let pushed = false;

    try {
      // Check if there are changes to team.jsonl
      const status = execSync(`git status --porcelain "${relativePath}"`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (!status) return { committed: false, pushed: false };

      // Stage and commit
      execSync(`git add "${relativePath}"`, {
        cwd: this.repoPath,
        timeout: 5000,
      });
      execSync(`git commit -m "teamlens: share team insights" --no-verify`, {
        cwd: this.repoPath,
        timeout: 5000,
      });
      committed = true;

      // Try to push (non-fatal if it fails)
      try {
        execSync('git push', {
          cwd: this.repoPath,
          timeout: 15000,
        });
        pushed = true;
      } catch {
        // Push failed (no remote, auth, etc.) — that's OK
      }
    } catch {
      // Not a git repo, or commit failed — non-fatal
    }

    return { committed, pushed };
  }

  /**
   * Auto-pull from git and import new team memories.
   * Called on MCP server startup to get teammates' latest insights.
   * Non-fatal — silently fails if not in a git repo or pull fails.
   */
  autoGitPullAndImport(): { pulled: boolean; imported: number } {
    let pulled = false;
    let imported = 0;

    try {
      execSync('git pull --rebase --autostash', {
        cwd: this.repoPath,
        timeout: 15000,
        stdio: 'pipe',
      });
      pulled = true;
    } catch {
      // Pull failed — try import anyway (file might have local changes)
    }

    imported = this.importFromShared();
    return { pulled, imported };
  }

  // ── Private ──

  /** Migrate shared.jsonl → team.jsonl if the old file exists. */
  private migrateIfNeeded(): void {
    if (fs.existsSync(this.legacyPath) && !fs.existsSync(this.teamPath)) {
      fs.renameSync(this.legacyPath, this.teamPath);
    }
  }

  private appendEntry(entry: SharedMemoryEntry): void {
    fs.appendFileSync(this.teamPath, JSON.stringify(entry) + '\n');
  }

  private memoryToEntry(memory: Memory): SharedMemoryEntry {
    return {
      id: memory.id,
      content: memory.content,
      category: memory.category,
      source: memory.source,
      author: memory.author,
      tags: memory.tags,
      relatedFiles: memory.relatedFiles,
      commitSha: memory.commitSha,
      confidence: memory.confidence,
      scope: memory.scope ?? null,
      priority: memory.priority ?? null,
      examples: memory.examples ?? null,
      active: memory.active,
      createdAt: memory.createdAt,
    };
  }
}
