import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type {
  Memory,
  MemoryCategory,
  MemorySource,
  TrackedFile,
  TrackedCommit,
  ExtractedMemory,
} from '../types.js';

export class MemoryDatabase {
  private db: Database.Database;

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    const dbPath = path.join(storageDir, 'memory.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  // ── Schema ──

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        category      TEXT NOT NULL,
        source        TEXT NOT NULL,
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
  }

  // ── Memories ──

  insertMemory(extracted: ExtractedMemory): Memory {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      content: extracted.content,
      category: extracted.category,
      source: extracted.commitSha ? 'git' : 'agent',
      tags: extracted.tags,
      relatedFiles: extracted.relatedFiles,
      commitSha: extracted.commitSha,
      staleness: 0,
      confidence: extracted.confidence,
      embedding: null,
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO memories (id, content, category, source, tags, related_files, commit_sha, staleness, confidence, embedding, created_at, updated_at, validated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        memory.content,
        memory.category,
        memory.source,
        JSON.stringify(memory.tags),
        JSON.stringify(memory.relatedFiles),
        memory.commitSha,
        memory.staleness,
        memory.confidence,
        null,
        memory.createdAt,
        memory.updatedAt,
        memory.validatedAt
      );

    return memory;
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  getAllMemories(includeStale = false): Memory[] {
    const query = includeStale
      ? 'SELECT * FROM memories ORDER BY created_at DESC'
      : 'SELECT * FROM memories WHERE staleness < 1.0 ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.rowToMemory);
  }

  getMemoriesByCategory(category: MemoryCategory): Memory[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE category = ? AND staleness < 1.0 ORDER BY created_at DESC')
      .all(category) as any[];
    return rows.map(this.rowToMemory);
  }

  getMemoriesByFile(filePath: string): Memory[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE related_files LIKE ? ORDER BY created_at DESC')
      .all(`%${filePath}%`) as any[];
    return rows.map(this.rowToMemory);
  }

  updateStaleness(id: string, staleness: number): void {
    this.db
      .prepare('UPDATE memories SET staleness = ?, updated_at = ? WHERE id = ?')
      .run(Math.min(staleness, 1.0), new Date().toISOString(), id);
  }

  updateEmbedding(id: string, embedding: number[]): void {
    this.db
      .prepare('UPDATE memories SET embedding = ?, updated_at = ? WHERE id = ?')
      .run(Buffer.from(new Float32Array(embedding).buffer), new Date().toISOString(), id);
  }

  validateMemory(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE memories SET staleness = 0.0, validated_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id);
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  getMemoryCount(): { total: number; stale: number; fresh: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;
    const stale = (
      this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE staleness >= 0.6').get() as any
    ).count;
    return { total, stale, fresh: total - stale };
  }

  // ── Tracked Files ──

  upsertTrackedFile(file: TrackedFile): void {
    this.db
      .prepare(
        `INSERT INTO tracked_files (path, hash, last_modified) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, last_modified = excluded.last_modified`
      )
      .run(file.path, file.hash, file.lastModified);
  }

  getTrackedFile(filePath: string): TrackedFile | null {
    return this.db.prepare('SELECT * FROM tracked_files WHERE path = ?').get(filePath) as TrackedFile | null;
  }

  removeTrackedFile(filePath: string): void {
    this.db.prepare('DELETE FROM tracked_files WHERE path = ?').run(filePath);
  }

  // ── Tracked Commits ──

  upsertCommit(commit: TrackedCommit): void {
    this.db
      .prepare(
        `INSERT INTO tracked_commits (sha, message, author, date, files, processed) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha) DO UPDATE SET processed = excluded.processed`
      )
      .run(commit.sha, commit.message, commit.author, commit.date, JSON.stringify(commit.files), commit.processed ? 1 : 0);
  }

  getUnprocessedCommits(): TrackedCommit[] {
    const rows = this.db
      .prepare('SELECT * FROM tracked_commits WHERE processed = 0 ORDER BY date ASC')
      .all() as any[];
    return rows.map((row) => ({
      sha: row.sha,
      message: row.message,
      author: row.author,
      date: row.date,
      files: JSON.parse(row.files),
      processed: Boolean(row.processed),
    }));
  }

  markCommitProcessed(sha: string): void {
    this.db.prepare('UPDATE tracked_commits SET processed = 1 WHERE sha = ?').run(sha);
  }

  // ── Helpers ──

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      category: row.category as MemoryCategory,
      source: row.source as MemorySource,
      tags: JSON.parse(row.tags),
      relatedFiles: JSON.parse(row.related_files),
      commitSha: row.commit_sha,
      staleness: row.staleness,
      confidence: row.confidence,
      embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer)) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      validatedAt: row.validated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
