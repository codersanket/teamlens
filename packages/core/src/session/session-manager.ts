import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MemoryDatabase } from '../store/database.js';
import type { TeamLensConfig, Session, ActivityEvent, ActivityType, Memory } from '../types.js';
import { InsightDetector } from './insight-detector.js';
import type { TeamSync } from '../sync/team-sync.js';
import type { EmbeddingProvider } from '../store/embeddings.js';

export class SessionManager {
  private currentSessionId: string | null = null;
  private sessionJustCreated = false;
  private insightDetector: InsightDetector;

  constructor(
    private db: MemoryDatabase,
    private config: TeamLensConfig,
    private teamSync: TeamSync,
    private embeddings: EmbeddingProvider,
  ) {
    this.insightDetector = new InsightDetector();
  }

  /** Get or create an active session. Auto-session pattern. */
  getOrCreateSession(toolName?: string): Session {
    // Check for existing active session
    const developer = this.config.developer !== 'unknown' ? this.config.developer : this.config.author;
    const existing = this.db.getActiveSession(developer);
    if (existing) {
      this.currentSessionId = existing.id;
      this.sessionJustCreated = false;
      return existing;
    }

    // Create new session
    const session = this.createSession(toolName);
    this.sessionJustCreated = true;
    return session;
  }

  /** Check if the last getOrCreateSession call created a new session. */
  wasSessionJustCreated(): boolean {
    return this.sessionJustCreated;
  }

  /** Explicitly start a session with task context. */
  startSession(task?: string, toolName?: string): Session {
    const developer = this.config.developer !== 'unknown' ? this.config.developer : this.config.author;

    // Close any existing active session
    const existing = this.db.getActiveSession(developer);
    if (existing) {
      this.db.closeSession(existing.id);
    }

    const session = this.createSession(toolName, task);
    return session;
  }

  /** End a session with optional summary. */
  endSession(sessionId?: string, summary?: string): Session | null {
    const id = sessionId ?? this.currentSessionId;
    if (!id) return null;

    this.db.closeSession(id, summary);

    if (id === this.currentSessionId) {
      this.currentSessionId = null;
    }

    return this.db.getSession(id);
  }

  /** Share an insight with the team. Auto-detects type, auto-creates session if needed. */
  async shareInsight(
    content: string,
    relatedFiles: string[] = [],
    tags: string[] = []
  ): Promise<{ memoryId: string; insightType: string; sessionId: string }> {
    // Ensure session exists
    const session = this.getOrCreateSession();

    // Auto-detect insight type
    const insightType = this.insightDetector.detect(content);
    const category = this.insightDetector.toCategory(insightType);
    const confidence = this.insightDetector.scoreConfidence(content, insightType);

    // Store as team memory with session context
    const memory = this.db.insertMemory(
      {
        content,
        category,
        relatedFiles,
        tags: [...tags, insightType],
        confidence,
        commitSha: null,
      },
      this.config.developer !== 'unknown' ? this.config.developer : this.config.author,
      'team',
      session.id
    );

    // Generate embedding
    const embedding = await this.embeddings.embed(content);
    if (embedding) {
      this.db.updateEmbedding(memory.id, embedding);
    }

    // Update session insight count
    this.db.updateSession(session.id, {
      insightCount: session.insightCount + 1,
    });

    // Export to team.jsonl (append-only, not full rewrite)
    this.teamSync.appendMemory(memory);

    // Auto-commit and push so teammates get it immediately
    this.teamSync.autoCommitAndPush();

    // Track related files
    for (const file of relatedFiles) {
      this.trackFile(session.id, file);
    }

    return {
      memoryId: memory.id,
      insightType,
      sessionId: session.id,
    };
  }

  /** Log an activity event. Auto-creates session if needed. */
  logActivity(
    type: ActivityType,
    description: string = '',
    files: string[] = []
  ): { eventId: string; sessionId: string } {
    const session = this.getOrCreateSession();

    const event: ActivityEvent = {
      id: randomUUID(),
      sessionId: session.id,
      type,
      description,
      files,
      timestamp: new Date().toISOString(),
    };

    this.db.insertActivityEvent(event);

    // Track files
    for (const file of files) {
      this.trackFile(session.id, file);
    }

    return {
      eventId: event.id,
      sessionId: session.id,
    };
  }

  /** Add a file to the session's files_touched list. */
  trackFile(sessionId: string, filePath: string): void {
    const session = this.db.getSession(sessionId);
    if (!session) return;

    if (!session.filesTouched.includes(filePath)) {
      session.filesTouched.push(filePath);
      this.db.updateSession(sessionId, {
        filesTouched: session.filesTouched,
      });
    }
  }

  /** Close stale sessions that have been active too long, auto-generating summaries. */
  cleanupStaleSessions(timeoutMinutes?: number): number {
    const timeout = timeoutMinutes ?? this.config.sessionTimeoutMinutes;
    const cutoff = new Date(Date.now() - timeout * 60 * 1000).toISOString();

    // Find stale sessions BEFORE the DB marks them abandoned,
    // so we can generate summaries and auto-share them.
    const developer = this.config.developer !== 'unknown' ? this.config.developer : this.config.author;
    const staleSessions = this.db.getAllSessions(100, 0)
      .filter(s => s.status === 'active' && s.startedAt < cutoff);

    for (const session of staleSessions) {
      this.autoEndSessionWithSummary(session.id);
    }

    return staleSessions.length;
  }

  /**
   * End a session and auto-generate a summary insight from its activities.
   * This ensures every session produces at least one team-visible record,
   * even if the AI never called share_insight.
   */
  async autoEndSessionWithSummary(sessionId: string): Promise<void> {
    const session = this.db.getSession(sessionId);
    if (!session || session.status !== 'active') return;

    const activities = this.db.getActivitiesBySession(sessionId);

    // Only auto-summarize sessions with meaningful work (3+ activities)
    if (activities.length >= 3 && session.insightCount === 0) {
      const summary = this.generateSessionSummary(session, activities);

      // Share as a team insight with category 'discovery'
      const memory = this.db.insertMemory(
        {
          content: summary,
          category: 'discovery',
          relatedFiles: session.filesTouched.slice(0, 10),
          tags: ['auto-summary', 'session'],
          confidence: 0.6,
          commitSha: null,
        },
        session.developer,
        'team',
        sessionId
      );

      // Export to team.jsonl so teammates see it
      this.teamSync.appendMemory(memory);
      this.teamSync.autoCommitAndPush();

      this.db.closeSession(sessionId, summary);
    } else {
      const summary = activities.length > 0
        ? this.generateSessionSummary(session, activities)
        : 'No significant activity';
      this.db.closeSession(sessionId, summary);
    }
  }

  /**
   * Generate a human-readable session summary from activity data.
   * Produces something like:
   *   "Session (32 min): Worked on auth module — edited session-manager.ts,
   *    insight-detector.ts, ran 5 commands. Focus: implementation + debugging."
   */
  generateSessionSummary(session: Session, activities: ActivityEvent[]): string {
    const durationMin = session.durationSeconds
      ? Math.round(session.durationSeconds / 60)
      : Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);

    // Collect unique files
    const files = [...new Set(session.filesTouched)];

    // Categorize activity types
    const typeCounts: Record<string, number> = {};
    for (const act of activities) {
      typeCounts[act.type] = (typeCounts[act.type] || 0) + 1;
    }

    // Find top activity types
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type.replace('_', ' '));

    // Find the common directory (module) being worked on
    const module = this.detectModule(files);

    // Build summary
    const parts: string[] = [];
    parts.push(`Session (${durationMin} min)`);

    if (session.task) {
      parts[0] += ` — ${session.task}`;
    } else if (module) {
      parts[0] += ` — worked on ${module}`;
    }

    if (files.length > 0) {
      const displayFiles = files.slice(0, 5).map(f => path.basename(f));
      parts.push(`Files: ${displayFiles.join(', ')}${files.length > 5 ? ` (+${files.length - 5} more)` : ''}`);
    }

    if (topTypes.length > 0) {
      parts.push(`Focus: ${topTypes.join(', ')}`);
    }

    if (session.insightCount > 0) {
      parts.push(`Shared ${session.insightCount} insight(s)`);
    }

    return parts.join('. ') + '.';
  }

  /**
   * Get an insight nudge message if the session has enough activity
   * but no insights shared yet. Returns null if no nudge needed.
   */
  getInsightNudge(): string | null {
    const session = this.getActiveSession();
    if (!session) return null;

    // Only nudge after significant activity with zero insights
    if (session.insightCount > 0) return null;
    if (session.activityCount < 5) return null;

    // Nudge once at 5 activities, then at 15, then at 30
    const nudgePoints = [5, 15, 30];
    if (!nudgePoints.includes(session.activityCount)) return null;

    return `You've done ${session.activityCount} activities in this session but haven't shared any insights. ` +
      `If you learned anything useful (gotchas, patterns, conventions), call share_insight so your teammates benefit.`;
  }

  /** Detect the common module/directory from a list of file paths. */
  private detectModule(files: string[]): string | null {
    if (files.length === 0) return null;

    const dirs = files
      .map(f => path.dirname(f))
      .filter(d => d !== '.' && d !== '/');

    if (dirs.length === 0) return null;

    // Find most common directory prefix
    const dirCounts: Record<string, number> = {};
    for (const dir of dirs) {
      // Use the first 2 segments as the module identifier
      const segments = dir.split(path.sep).slice(0, 3);
      const key = segments.join('/');
      dirCounts[key] = (dirCounts[key] || 0) + 1;
    }

    const topDir = Object.entries(dirCounts)
      .sort((a, b) => b[1] - a[1])[0];

    return topDir ? topDir[0] : null;
  }

  /** Get the current active session. */
  getActiveSession(): Session | null {
    if (this.currentSessionId) {
      return this.db.getSession(this.currentSessionId);
    }
    const developer = this.config.developer !== 'unknown' ? this.config.developer : this.config.author;
    return this.db.getActiveSession(developer);
  }

  /** Get team context for injection at session start. */
  getTeamContext(limit = 10): Memory[] {
    return this.db.getRecentInsights(limit);
  }

  /**
   * Ingest hook events from .teamlens/hooks.jsonl into the database.
   * Called by the MCP server before each tool handler to pick up
   * activity logged by Claude Code PostToolUse hooks.
   */
  ingestHookEvents(repoPath: string): number {
    const hooksFile = path.join(repoPath, this.config.storageDir, 'hooks.jsonl');
    if (!fs.existsSync(hooksFile)) return 0;

    const content = fs.readFileSync(hooksFile, 'utf-8').trim();
    if (!content) return 0;

    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0) return 0;

    const session = this.getOrCreateSession();
    let ingested = 0;

    for (const line of lines) {
      try {
        const hookEvent = JSON.parse(line);
        const event: ActivityEvent = {
          id: randomUUID(),
          sessionId: session.id,
          type: (hookEvent.type as ActivityType) ?? 'other',
          description: hookEvent.description ?? hookEvent.tool ?? '',
          files: hookEvent.files ?? [],
          timestamp: hookEvent.timestamp ?? new Date().toISOString(),
        };
        this.db.insertActivityEvent(event);

        // Track files
        for (const file of event.files) {
          this.trackFile(session.id, file);
        }

        ingested++;
      } catch {
        // Skip malformed lines
      }
    }

    // Update session activity count
    if (ingested > 0) {
      const updated = this.db.getSession(session.id);
      if (updated) {
        this.db.updateSession(session.id, {
          activityCount: updated.activityCount + ingested,
        });
      }
    }

    // Clear the hooks file after ingestion
    fs.writeFileSync(hooksFile, '');

    return ingested;
  }

  // ── Private ──

  private createSession(toolName?: string, task?: string): Session {
    const developer = this.config.developer !== 'unknown' ? this.config.developer : this.config.author;
    const session: Session = {
      id: randomUUID(),
      developer,
      task: task ?? '',
      status: 'active',
      toolName: toolName ?? 'unknown',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationSeconds: null,
      filesTouched: [],
      summary: null,
      insightCount: 0,
      activityCount: 0,
      duplicatesPrevented: 0,
    };

    this.db.insertSession(session);
    this.currentSessionId = session.id;

    // Cleanup any stale sessions
    this.cleanupStaleSessions();

    return session;
  }
}
