import initSqlJs, { type Database } from 'sql.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import picomatch from 'picomatch';
import type {
  Memory,
  MemoryCategory,
  MemorySource,
  MemoryTier,
  RulePriority,
  TrackedFile,
  TrackedCommit,
  ExtractedMemory,
  Session,
  SessionStatus,
  ActivityEvent,
  ActivityType,
} from '../types.js';

export class MemoryDatabase {
  private db!: Database;
  private dbPath: string;
  private sqlModule!: Awaited<ReturnType<typeof initSqlJs>>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  private constructor(private storageDir: string) {
    this.dbPath = path.join(storageDir, 'memory.db');
  }

  /** Async factory — sql.js requires async initialization. */
  static async create(storageDir: string): Promise<MemoryDatabase> {
    const instance = new MemoryDatabase(storageDir);
    fs.mkdirSync(storageDir, { recursive: true });

    const SQL = await initSqlJs();
    instance.sqlModule = SQL;

    if (fs.existsSync(instance.dbPath)) {
      const buffer = fs.readFileSync(instance.dbPath);
      instance.db = new SQL.Database(buffer);
    } else {
      instance.db = new SQL.Database();
    }

    instance.migrate();
    instance.save();
    return instance;
  }

  /** Reload the database from disk. Use when another process may have written changes. */
  reload(): void {
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db.close();
      this.db = new this.sqlModule.Database(buffer);
    }
  }

  // ── Compatibility Helpers ──

  private queryOne(sql: string, ...params: any[]): any | undefined {
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  private queryAll(sql: string, ...params: any[]): any[] {
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  private execute(sql: string, ...params: any[]): void {
    this.db.run(sql, params);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return; // already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.save();
        this.dirty = false;
      }
    }, 100); // 100ms debounce
  }

  private save(): void {
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  /** Force an immediate save (call before close). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.save();
      this.dirty = false;
    }
  }

  // ── Schema ──

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        category      TEXT NOT NULL,
        source        TEXT NOT NULL,
        tier          TEXT NOT NULL DEFAULT 'personal',
        author        TEXT NOT NULL DEFAULT 'unknown',
        tags          TEXT NOT NULL DEFAULT '[]',
        related_files TEXT NOT NULL DEFAULT '[]',
        commit_sha    TEXT,
        staleness     REAL NOT NULL DEFAULT 0.0,
        confidence    REAL NOT NULL DEFAULT 0.8,
        embedding     BLOB,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        validated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracked_files (
        path          TEXT PRIMARY KEY,
        hash          TEXT NOT NULL,
        last_modified TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracked_commits (
        sha       TEXT PRIMARY KEY,
        message   TEXT NOT NULL,
        author    TEXT NOT NULL,
        date      TEXT NOT NULL,
        files     TEXT NOT NULL DEFAULT '[]',
        processed INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_staleness ON memories(staleness);
      CREATE INDEX IF NOT EXISTS idx_memories_commit ON memories(commit_sha);
    `);

    // Migration: add tier/author columns if upgrading from v0.1
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN tier TEXT NOT NULL DEFAULT 'personal'`);
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT 'unknown'`);
    } catch { /* column already exists */ }

    // Create indexes for tier/author (after migration ensures columns exist)
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
      CREATE INDEX IF NOT EXISTS idx_memories_author ON memories(author);
    `);

    // Migration: add governance columns
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN scope TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN priority TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN examples TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    } catch { /* column already exists */ }

    // Indexes for governance queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
      CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(active);
      CREATE INDEX IF NOT EXISTS idx_memories_priority ON memories(priority);
    `);

    // Migration: add session tracking columns
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN session_id TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      this.db.run(`ALTER TABLE memories ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0`);
    } catch { /* column already exists */ }

    // Sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                   TEXT PRIMARY KEY,
        developer            TEXT NOT NULL,
        task                 TEXT DEFAULT '',
        status               TEXT DEFAULT 'active',
        tool_name            TEXT DEFAULT 'unknown',
        started_at           TEXT NOT NULL,
        ended_at             TEXT,
        duration_seconds     INTEGER,
        files_touched        TEXT DEFAULT '[]',
        summary              TEXT,
        insight_count        INTEGER DEFAULT 0,
        activity_count       INTEGER DEFAULT 0,
        duplicates_prevented INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    `);

    // Activity events table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        type        TEXT NOT NULL,
        description TEXT DEFAULT '',
        files       TEXT DEFAULT '[]',
        timestamp   TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_events(session_id);
    `);
  }

  // ── Memories ──

  insertMemory(extracted: ExtractedMemory, author: string, tier: MemoryTier = 'personal', sessionId?: string): Memory {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      content: extracted.content,
      category: extracted.category,
      source: extracted.commitSha ? 'git' : 'agent',
      tier,
      author,
      tags: extracted.tags,
      relatedFiles: extracted.relatedFiles,
      commitSha: extracted.commitSha,
      staleness: 0,
      confidence: extracted.confidence,
      embedding: null,
      scope: null,
      priority: null,
      examples: null,
      active: true,
      sessionId: sessionId ?? null,
      reuseCount: 0,
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
    };

    this.execute(
      `INSERT INTO memories (id, content, category, source, tier, author, tags, related_files, commit_sha, staleness, confidence, embedding, scope, priority, examples, active, session_id, reuse_count, created_at, updated_at, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memory.id,
      memory.content,
      memory.category,
      memory.source,
      memory.tier,
      memory.author,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.relatedFiles),
      memory.commitSha,
      memory.staleness,
      memory.confidence,
      null,
      null,
      null,
      null,
      1,
      memory.sessionId,
      0,
      memory.createdAt,
      memory.updatedAt,
      memory.validatedAt
    );

    return memory;
  }

  /** Insert a team memory with a known id (for import from team.jsonl). */
  insertTeamMemory(memory: Omit<Memory, 'embedding' | 'updatedAt' | 'validatedAt' | 'staleness' | 'sessionId' | 'reuseCount'>): void {
    const now = new Date().toISOString();
    this.execute(
      `INSERT OR IGNORE INTO memories (id, content, category, source, tier, author, tags, related_files, commit_sha, staleness, confidence, embedding, scope, priority, examples, active, session_id, reuse_count, created_at, updated_at, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memory.id,
      memory.content,
      memory.category,
      memory.source,
      'team',
      memory.author,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.relatedFiles),
      memory.commitSha,
      0,
      memory.confidence,
      null,
      memory.scope ? JSON.stringify(memory.scope) : null,
      memory.priority ?? null,
      memory.examples ? JSON.stringify(memory.examples) : null,
      memory.active ? 1 : 0,
      null,
      0,
      memory.createdAt,
      now,
      now
    );
  }

  getMemory(id: string): Memory | null {
    const row = this.queryOne('SELECT * FROM memories WHERE id = ?', id);
    return row ? this.rowToMemory(row) : null;
  }

  getAllMemories(includeStale = false): Memory[] {
    const query = includeStale
      ? 'SELECT * FROM memories ORDER BY created_at DESC'
      : 'SELECT * FROM memories WHERE staleness < 1.0 ORDER BY created_at DESC';
    const rows = this.queryAll(query);
    return rows.map((r) => this.rowToMemory(r));
  }

  getMemoriesByTier(tier: MemoryTier, includeStale = false): Memory[] {
    const query = includeStale
      ? 'SELECT * FROM memories WHERE tier = ? ORDER BY created_at DESC'
      : 'SELECT * FROM memories WHERE tier = ? AND staleness < 1.0 ORDER BY created_at DESC';
    const rows = this.queryAll(query, tier);
    return rows.map((r) => this.rowToMemory(r));
  }

  getMemoriesByCategory(category: MemoryCategory): Memory[] {
    const rows = this.queryAll(
      'SELECT * FROM memories WHERE category = ? AND staleness < 1.0 ORDER BY created_at DESC',
      category
    );
    return rows.map((r) => this.rowToMemory(r));
  }

  getMemoriesByFile(filePath: string): Memory[] {
    const rows = this.queryAll(
      'SELECT * FROM memories WHERE related_files LIKE ? ORDER BY created_at DESC',
      `%${filePath}%`
    );
    return rows.map((r) => this.rowToMemory(r));
  }

  getMemoriesByAuthor(author: string): Memory[] {
    const rows = this.queryAll(
      'SELECT * FROM memories WHERE author = ? AND staleness < 1.0 ORDER BY created_at DESC',
      author
    );
    return rows.map((r) => this.rowToMemory(r));
  }

  getTeamAuthors(): { author: string; count: number }[] {
    const rows = this.queryAll(
      `SELECT author, COUNT(*) as count FROM memories WHERE tier = 'team' AND staleness < 1.0 GROUP BY author ORDER BY count DESC`
    );
    return rows.map((r) => ({ author: r.author as string, count: r.count as number }));
  }

  getMemoriesBySessionId(sessionId: string): Memory[] {
    const rows = this.queryAll(
      'SELECT * FROM memories WHERE session_id = ? ORDER BY created_at DESC',
      sessionId
    );
    return rows.map((r) => this.rowToMemory(r));
  }

  updateTier(id: string, tier: MemoryTier): void {
    this.execute('UPDATE memories SET tier = ?, updated_at = ? WHERE id = ?', tier, new Date().toISOString(), id);
  }

  updateStaleness(id: string, staleness: number): void {
    this.execute(
      'UPDATE memories SET staleness = ?, updated_at = ? WHERE id = ?',
      Math.min(staleness, 1.0),
      new Date().toISOString(),
      id
    );
  }

  updateEmbedding(id: string, embedding: number[]): void {
    const buffer = Buffer.from(new Float32Array(embedding).buffer);
    this.execute('UPDATE memories SET embedding = ?, updated_at = ? WHERE id = ?', buffer, new Date().toISOString(), id);
  }

  validateMemory(id: string): void {
    const now = new Date().toISOString();
    this.execute('UPDATE memories SET staleness = 0.0, validated_at = ?, updated_at = ? WHERE id = ?', now, now, id);
  }

  deleteMemory(id: string): void {
    this.execute('DELETE FROM memories WHERE id = ?', id);
  }

  hasMemory(id: string): boolean {
    const row = this.queryOne('SELECT 1 FROM memories WHERE id = ?', id);
    return !!row;
  }

  incrementReuseCount(id: string): void {
    this.execute('UPDATE memories SET reuse_count = reuse_count + 1, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
  }

  getTotalReuseCount(): number {
    const row = this.queryOne('SELECT COALESCE(SUM(reuse_count), 0) as total FROM memories');
    return (row?.total as number) ?? 0;
  }

  getMemoryCount(): { total: number; stale: number; fresh: number; team: number; personal: number } {
    const total = (this.queryOne('SELECT COUNT(*) as count FROM memories') as any).count;
    const stale = (this.queryOne('SELECT COUNT(*) as count FROM memories WHERE staleness >= 0.6') as any).count;
    const team = (this.queryOne("SELECT COUNT(*) as count FROM memories WHERE tier = 'team'") as any).count;
    return { total, stale, fresh: total - stale, team, personal: total - team };
  }

  // ── Rule Methods ──

  /** Get all rules, ordered by priority. Optionally include inactive. */
  getRules(includeInactive = false): Memory[] {
    const query = includeInactive
      ? `SELECT * FROM memories WHERE source = 'rule' ORDER BY
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END,
           created_at DESC`
      : `SELECT * FROM memories WHERE source = 'rule' AND active = 1 ORDER BY
           CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END,
           created_at DESC`;
    const rows = this.queryAll(query);
    return rows.map((r) => this.rowToMemory(r));
  }

  /** Get rules that apply to a specific file path (by scope glob matching). */
  getRulesForFile(filePath: string): Memory[] {
    const allRules = this.getRules(false);
    return allRules.filter((rule) => {
      if (!rule.scope || rule.scope.length === 0) return true; // global rule
      return picomatch.isMatch(filePath, rule.scope);
    });
  }

  /** Toggle a rule active/inactive. */
  setRuleActive(id: string, active: boolean): void {
    this.execute('UPDATE memories SET active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, new Date().toISOString(), id);
  }

  /** Update governance-specific fields on a memory (scope, priority, examples, source). */
  updateRuleFields(
    id: string,
    fields: {
      source?: MemorySource;
      scope?: string[] | null;
      priority?: RulePriority | null;
      examples?: { good?: string; bad?: string } | null;
    }
  ): void {
    const updates: string[] = [];
    const params: any[] = [];

    if (fields.source !== undefined) {
      updates.push('source = ?');
      params.push(fields.source);
    }
    if (fields.scope !== undefined) {
      updates.push('scope = ?');
      params.push(fields.scope ? JSON.stringify(fields.scope) : null);
    }
    if (fields.priority !== undefined) {
      updates.push('priority = ?');
      params.push(fields.priority);
    }
    if (fields.examples !== undefined) {
      updates.push('examples = ?');
      params.push(fields.examples ? JSON.stringify(fields.examples) : null);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.execute(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`, ...params);
  }

  // ── Sessions ──

  insertSession(session: Session): void {
    this.execute(
      `INSERT INTO sessions (id, developer, task, status, tool_name, started_at, ended_at, duration_seconds, files_touched, summary, insight_count, activity_count, duplicates_prevented)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      session.developer,
      session.task,
      session.status,
      session.toolName,
      session.startedAt,
      session.endedAt,
      session.durationSeconds,
      JSON.stringify(session.filesTouched),
      session.summary,
      session.insightCount,
      session.activityCount,
      session.duplicatesPrevented
    );
  }

  updateSession(id: string, fields: Partial<Omit<Session, 'id'>>): void {
    const updates: string[] = [];
    const params: any[] = [];

    if (fields.status !== undefined) { updates.push('status = ?'); params.push(fields.status); }
    if (fields.task !== undefined) { updates.push('task = ?'); params.push(fields.task); }
    if (fields.endedAt !== undefined) { updates.push('ended_at = ?'); params.push(fields.endedAt); }
    if (fields.durationSeconds !== undefined) { updates.push('duration_seconds = ?'); params.push(fields.durationSeconds); }
    if (fields.filesTouched !== undefined) { updates.push('files_touched = ?'); params.push(JSON.stringify(fields.filesTouched)); }
    if (fields.summary !== undefined) { updates.push('summary = ?'); params.push(fields.summary); }
    if (fields.insightCount !== undefined) { updates.push('insight_count = ?'); params.push(fields.insightCount); }
    if (fields.activityCount !== undefined) { updates.push('activity_count = ?'); params.push(fields.activityCount); }
    if (fields.duplicatesPrevented !== undefined) { updates.push('duplicates_prevented = ?'); params.push(fields.duplicatesPrevented); }

    if (updates.length === 0) return;
    params.push(id);

    this.execute(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, ...params);
  }

  getSession(id: string): Session | null {
    const row = this.queryOne('SELECT * FROM sessions WHERE id = ?', id);
    return row ? this.rowToSession(row) : null;
  }

  getActiveSession(developer: string): Session | null {
    const row = this.queryOne(
      `SELECT * FROM sessions WHERE developer = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
      developer
    );
    return row ? this.rowToSession(row) : null;
  }

  getSessionsInRange(startDate: string, endDate: string, limit = 100): Session[] {
    const rows = this.queryAll(
      'SELECT * FROM sessions WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC LIMIT ?',
      startDate, endDate, limit
    );
    return rows.map((r) => this.rowToSession(r));
  }

  getAllSessions(limit = 100, offset = 0): Session[] {
    const rows = this.queryAll(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?',
      limit, offset
    );
    return rows.map((r) => this.rowToSession(r));
  }

  closeSession(id: string, summary?: string): void {
    const session = this.getSession(id);
    if (!session) return;

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000
    );

    this.updateSession(id, {
      status: 'completed',
      endedAt,
      durationSeconds,
      summary: summary ?? session.summary,
    });
  }

  cleanupStaleSessions(timeoutMinutes: number): number {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
    const staleSessions = this.queryAll(
      `SELECT * FROM sessions WHERE status = 'active' AND started_at < ?`,
      cutoff
    );

    for (const row of staleSessions) {
      const session = this.rowToSession(row);
      this.updateSession(session.id, {
        status: 'abandoned',
        endedAt: new Date().toISOString(),
        durationSeconds: Math.round(
          (Date.now() - new Date(session.startedAt).getTime()) / 1000
        ),
      });
    }

    return staleSessions.length;
  }

  // ── Activity Events ──

  insertActivityEvent(event: ActivityEvent): void {
    this.execute(
      `INSERT INTO activity_events (id, session_id, type, description, files, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      event.id,
      event.sessionId,
      event.type,
      event.description,
      JSON.stringify(event.files),
      event.timestamp
    );

    // Increment activity count on session
    this.execute(
      'UPDATE sessions SET activity_count = activity_count + 1 WHERE id = ?',
      event.sessionId
    );
  }

  getActivitiesBySession(sessionId: string): ActivityEvent[] {
    const rows = this.queryAll(
      'SELECT * FROM activity_events WHERE session_id = ? ORDER BY timestamp ASC',
      sessionId
    );
    return rows.map((r) => this.rowToActivity(r));
  }

  // ── Analytics Queries ──

  getInsightCountsByDeveloper(): { developer: string; count: number }[] {
    const rows = this.queryAll(
      `SELECT author as developer, COUNT(*) as count FROM memories
       WHERE tier = 'team' AND staleness < 1.0
       GROUP BY author ORDER BY count DESC`
    );
    return rows.map((r) => ({ developer: r.developer as string, count: r.count as number }));
  }

  getSessionCountsByDate(days: number): { date: string; count: number }[] {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = this.queryAll(
      `SELECT DATE(started_at) as date, COUNT(*) as count FROM sessions
       WHERE DATE(started_at) >= ? GROUP BY DATE(started_at) ORDER BY date ASC`,
      since
    );
    return rows.map((r) => ({ date: r.date as string, count: r.count as number }));
  }

  getInsightCountsByDate(days: number): { date: string; count: number }[] {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = this.queryAll(
      `SELECT DATE(created_at) as date, COUNT(*) as count FROM memories
       WHERE tier = 'team' AND DATE(created_at) >= ? GROUP BY DATE(created_at) ORDER BY date ASC`,
      since
    );
    return rows.map((r) => ({ date: r.date as string, count: r.count as number }));
  }

  getActiveDevelopersByDate(days: number): { date: string; count: number }[] {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const rows = this.queryAll(
      `SELECT DATE(started_at) as date, COUNT(DISTINCT developer) as count FROM sessions
       WHERE DATE(started_at) >= ? GROUP BY DATE(started_at) ORDER BY date ASC`,
      since
    );
    return rows.map((r) => ({ date: r.date as string, count: r.count as number }));
  }

  getHotFiles(limit = 10): { filePath: string; count: number; lastInsight: string }[] {
    // Only fetch the two columns we need instead of full Memory objects
    const memories = this.queryAll(
      `SELECT related_files, created_at FROM memories
       WHERE tier = 'team' AND staleness < 1.0 AND related_files != '[]'
       ORDER BY created_at DESC`
    );

    const fileMap = new Map<string, { count: number; lastInsight: string }>();

    for (const row of memories) {
      try {
        const files: string[] = JSON.parse(row.related_files as string);
        for (const file of files) {
          const existing = fileMap.get(file);
          if (!existing) {
            fileMap.set(file, { count: 1, lastInsight: row.created_at as string });
          } else {
            existing.count++;
            if ((row.created_at as string) > existing.lastInsight) {
              existing.lastInsight = row.created_at as string;
            }
          }
        }
      } catch { /* skip malformed */ }
    }

    return Array.from(fileMap.entries())
      .map(([filePath, data]) => ({ filePath, count: data.count, lastInsight: data.lastInsight }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getTotalSessionCount(): number {
    const row = this.queryOne('SELECT COUNT(*) as count FROM sessions');
    return (row?.count as number) ?? 0;
  }

  getTotalSessionDuration(): number {
    const row = this.queryOne('SELECT COALESCE(SUM(duration_seconds), 0) as total FROM sessions WHERE duration_seconds IS NOT NULL');
    return (row?.total as number) ?? 0;
  }

  getDistinctDevelopers(): string[] {
    const rows = this.queryAll('SELECT DISTINCT developer FROM sessions ORDER BY developer ASC');
    return rows.map((r) => r.developer as string);
  }

  getDuplicatesPrevented(): number {
    const row = this.queryOne('SELECT COALESCE(SUM(duplicates_prevented), 0) as total FROM sessions');
    return (row?.total as number) ?? 0;
  }

  getSessionsByDeveloper(developer: string): Session[] {
    const rows = this.queryAll(
      'SELECT * FROM sessions WHERE developer = ? ORDER BY started_at DESC',
      developer
    );
    return rows.map((r) => this.rowToSession(r));
  }

  getInsightsByCategory(): Record<string, number> {
    const rows = this.queryAll(
      `SELECT category, COUNT(*) as count FROM memories
       WHERE tier = 'team' AND staleness < 1.0
       GROUP BY category ORDER BY count DESC`
    );
    const result: Record<string, number> = {};
    for (const r of rows) {
      result[r.category as string] = r.count as number;
    }
    return result;
  }

  getRecentInsights(limit = 20): Memory[] {
    const rows = this.queryAll(
      `SELECT * FROM memories WHERE tier = 'team' AND staleness < 1.0
       ORDER BY created_at DESC LIMIT ?`,
      limit
    );
    return rows.map((r) => this.rowToMemory(r));
  }

  // ── Optimized SQL Counts (for analytics) ──

  getTeamInsightCount(): number {
    const row = this.queryOne(
      `SELECT COUNT(*) as count FROM memories WHERE tier = 'team' AND staleness < 1.0`
    );
    return (row?.count as number) ?? 0;
  }

  getTeamInsightCountSince(since: string): number {
    const row = this.queryOne(
      `SELECT COUNT(*) as count FROM memories WHERE tier = 'team' AND staleness < 1.0 AND created_at >= ?`,
      since
    );
    return (row?.count as number) ?? 0;
  }

  getActiveSessionCount(): number {
    const row = this.queryOne(
      `SELECT COUNT(*) as count FROM sessions WHERE status = 'active'`
    );
    return (row?.count as number) ?? 0;
  }

  getTotalActivityCount(): number {
    const row = this.queryOne(
      `SELECT COUNT(*) as count FROM activity_events`
    );
    return (row?.count as number) ?? 0;
  }

  getAvgSessionDuration(): number {
    const row = this.queryOne(
      `SELECT COALESCE(AVG(duration_seconds), 0) as avg FROM sessions WHERE duration_seconds IS NOT NULL`
    );
    return Math.round((row?.avg as number) ?? 0);
  }

  // ── Tracked Files ──

  upsertTrackedFile(file: TrackedFile): void {
    this.execute(
      `INSERT INTO tracked_files (path, hash, last_modified) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, last_modified = excluded.last_modified`,
      file.path,
      file.hash,
      file.lastModified
    );
  }

  getTrackedFile(filePath: string): TrackedFile | null {
    const row = this.queryOne('SELECT * FROM tracked_files WHERE path = ?', filePath);
    if (!row) return null;
    return { path: row.path as string, hash: row.hash as string, lastModified: row.last_modified as string };
  }

  removeTrackedFile(filePath: string): void {
    this.execute('DELETE FROM tracked_files WHERE path = ?', filePath);
  }

  // ── Tracked Commits ──

  upsertCommit(commit: TrackedCommit): void {
    this.execute(
      `INSERT INTO tracked_commits (sha, message, author, date, files, processed) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sha) DO UPDATE SET processed = excluded.processed`,
      commit.sha,
      commit.message,
      commit.author,
      commit.date,
      JSON.stringify(commit.files),
      commit.processed ? 1 : 0
    );
  }

  getUnprocessedCommits(): TrackedCommit[] {
    const rows = this.queryAll('SELECT * FROM tracked_commits WHERE processed = 0 ORDER BY date ASC');
    return rows.map((row) => ({
      sha: row.sha as string,
      message: row.message as string,
      author: row.author as string,
      date: row.date as string,
      files: JSON.parse(row.files as string),
      processed: Boolean(row.processed),
    }));
  }

  markCommitProcessed(sha: string): void {
    this.execute('UPDATE tracked_commits SET processed = 1 WHERE sha = ?', sha);
  }

  // ── Helpers ──

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      category: row.category as MemoryCategory,
      source: row.source as MemorySource,
      tier: (row.tier ?? 'personal') as MemoryTier,
      author: row.author ?? 'unknown',
      tags: JSON.parse(row.tags as string),
      relatedFiles: JSON.parse(row.related_files as string),
      commitSha: row.commit_sha,
      staleness: row.staleness,
      confidence: row.confidence,
      embedding: row.embedding ? Array.from(new Float32Array((row.embedding as Uint8Array).buffer)) : null,
      scope: row.scope ? JSON.parse(row.scope as string) : null,
      priority: (row.priority as RulePriority) ?? null,
      examples: row.examples ? JSON.parse(row.examples as string) : null,
      active: row.active === undefined ? true : Boolean(row.active),
      sessionId: row.session_id ?? null,
      reuseCount: row.reuse_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      validatedAt: row.validated_at,
    };
  }

  private rowToSession(row: any): Session {
    return {
      id: row.id as string,
      developer: row.developer as string,
      task: (row.task as string) ?? '',
      status: (row.status as SessionStatus) ?? 'active',
      toolName: (row.tool_name as string) ?? 'unknown',
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string) ?? null,
      durationSeconds: (row.duration_seconds as number) ?? null,
      filesTouched: JSON.parse((row.files_touched as string) ?? '[]'),
      summary: (row.summary as string) ?? null,
      insightCount: (row.insight_count as number) ?? 0,
      activityCount: (row.activity_count as number) ?? 0,
      duplicatesPrevented: (row.duplicates_prevented as number) ?? 0,
    };
  }

  private rowToActivity(row: any): ActivityEvent {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      type: row.type as ActivityType,
      description: (row.description as string) ?? '',
      files: JSON.parse((row.files as string) ?? '[]'),
      timestamp: row.timestamp as string,
    };
  }

  close(): void {
    this.flush();
    this.db.close();
  }
}
