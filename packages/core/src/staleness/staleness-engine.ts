import type { MemoryDatabase } from '../store/database.js';
import type { GitExtractor } from '../extractor/git-extractor.js';
import type { StalenessCheck, Memory } from '../types.js';

/**
 * Staleness Engine — auto-invalidates memories when referenced files change.
 *
 * On each git event:
 *  1. Get changed files from diff
 *  2. Find memories that reference those files
 *  3. Score staleness based on change magnitude
 *  4. Update memory staleness scores
 *
 * Stale memories are downranked in retrieval, not deleted.
 */
export class StalenessEngine {
  constructor(
    private db: MemoryDatabase,
    private git: GitExtractor
  ) {}

  /** Check all memories against current file states. Returns list of changes made. */
  async checkAll(): Promise<StalenessCheck[]> {
    const checks: StalenessCheck[] = [];
    const memories = this.db.getAllMemories(true);

    for (const memory of memories) {
      const memoryChecks = await this.checkMemory(memory);
      checks.push(...memoryChecks);
    }

    return checks;
  }

  /** Check a single memory against its referenced files. */
  async checkMemory(memory: Memory): Promise<StalenessCheck[]> {
    const checks: StalenessCheck[] = [];

    for (const filePath of memory.relatedFiles) {
      const tracked = this.db.getTrackedFile(filePath);
      if (!tracked) {
        // File was never tracked — might be new or deleted
        const currentHash = await this.git.getFileHash(filePath);
        if (!currentHash) {
          // File doesn't exist → hard stale
          checks.push(this.applyStale(memory, filePath, 'file_deleted', 1.0));
        }
        continue;
      }

      const currentHash = await this.git.getFileHash(filePath);

      if (!currentHash) {
        // File deleted since last tracking
        checks.push(this.applyStale(memory, filePath, 'file_deleted', 1.0));
        this.db.removeTrackedFile(filePath);
        continue;
      }

      if (currentHash !== tracked.hash) {
        // File changed — determine magnitude
        const staleDelta = await this.estimateChangeMagnitude(filePath, tracked.hash, currentHash);
        if (staleDelta > 0) {
          const reason = staleDelta >= 0.8 ? 'major_refactor' : 'minor_edit';
          checks.push(this.applyStale(memory, filePath, reason, staleDelta));
        }

        // Update tracked file hash
        this.db.upsertTrackedFile({
          path: filePath,
          hash: currentHash,
          lastModified: new Date().toISOString(),
        });
      }
    }

    return checks;
  }

  /** Process a set of changed files (e.g., from a git hook). */
  async processChangedFiles(changedFiles: string[]): Promise<StalenessCheck[]> {
    const checks: StalenessCheck[] = [];

    for (const filePath of changedFiles) {
      const memories = this.db.getMemoriesByFile(filePath);

      for (const memory of memories) {
        const currentHash = await this.git.getFileHash(filePath);

        if (!currentHash) {
          checks.push(this.applyStale(memory, filePath, 'file_deleted', 1.0));
          continue;
        }

        const tracked = this.db.getTrackedFile(filePath);
        if (tracked && tracked.hash !== currentHash) {
          const staleDelta = await this.estimateChangeMagnitude(filePath, tracked.hash, currentHash);
          if (staleDelta > 0) {
            const reason = staleDelta >= 0.8 ? 'major_refactor' : 'minor_edit';
            checks.push(this.applyStale(memory, filePath, reason, staleDelta));
          }
        }

        // Update tracking
        this.db.upsertTrackedFile({
          path: filePath,
          hash: currentHash,
          lastModified: new Date().toISOString(),
        });
      }
    }

    return checks;
  }

  // ── Private ──

  private applyStale(
    memory: Memory,
    changedFile: string,
    reason: StalenessCheck['reason'],
    delta: number
  ): StalenessCheck {
    const oldStaleness = memory.staleness;
    const newStaleness = Math.min(oldStaleness + delta, 1.0);

    this.db.updateStaleness(memory.id, newStaleness);

    return {
      memoryId: memory.id,
      reason,
      oldStaleness,
      newStaleness,
      changedFile,
    };
  }

  /**
   * Estimate how much a file change should affect staleness.
   *
   * Heuristic based on file name patterns:
   * - Config files changing → high impact (0.7)
   * - Test files changing → low impact (0.1)
   * - Source files → medium (0.3–0.5)
   */
  private async estimateChangeMagnitude(
    _filePath: string,
    _oldHash: string,
    _newHash: string
  ): Promise<number> {
    // TODO: Use git diff --stat to get insertions/deletions for finer scoring.
    // For MVP, use file-path heuristics.

    const path = _filePath.toLowerCase();

    // Config files → high impact
    if (path.match(/\.(config|rc|env|yaml|yml|toml|json)$/) && !path.includes('package-lock')) {
      return 0.7;
    }

    // Test files → low impact
    if (path.match(/\.(test|spec|e2e)\./)) {
      return 0.1;
    }

    // Generated files → ignore
    if (path.match(/\.(lock|min\.|map)$/) || path.includes('generated')) {
      return 0;
    }

    // Documentation → low-medium
    if (path.match(/\.(md|txt|rst)$/)) {
      return 0.2;
    }

    // Source files → medium
    return 0.4;
  }
}
