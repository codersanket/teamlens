import { randomUUID } from 'node:crypto';
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

  /** Close stale sessions that have been active too long. */
  cleanupStaleSessions(timeoutMinutes?: number): number {
    const timeout = timeoutMinutes ?? this.config.sessionTimeoutMinutes;
    return this.db.cleanupStaleSessions(timeout);
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
