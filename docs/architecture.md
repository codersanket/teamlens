# CodeMemory — Architecture

Git-aware memory layer for AI coding agents. Watches your repo, builds structured knowledge, serves it to any agent via MCP.

## Problem

Every AI coding agent is stateless. Each session starts from zero — the agent re-discovers your architecture, re-learns your conventions, and repeats mistakes it was already corrected on. Context windows have hard limits while codebases have none.

Worse: on teams, each developer's agent learns things independently. One agent discovers a convention, another breaks it next session. Team knowledge stays locked in individual heads.

CodeMemory fixes both by maintaining a persistent, git-aware memory layer with **team sync** — any agent can read and write, and team memories propagate via git.

## How to Use

### 1. Install

```bash
git clone https://github.com/codersanket/codememory.git
cd codememory
pnpm install
pnpm build
```

### 2. One Command Setup

```bash
codememory setup --path /path/to/your/repo
```

That's it. This single command:
- Detects installed AI agents (Claude Code, Cursor, Windsurf)
- Adds CodeMemory to their MCP config automatically
- Initializes the memory store if it doesn't exist (scans git history, tracks files)

Output:
```
CodeMemory Setup

  Claude Code: configured (global — works in any repo)
    /Users/you/.claude/settings.json

  1 agent(s) configured.
  Restart your agent to pick up the new tools.

  No memory store found — initializing...

  Files tracked:    66
  Memories created: 3
  Storage:          /path/to/your/repo/.codememory/

  You're all set.
```

The `setup` command auto-detects agents by scope:

| Agent | Scope | Config File | Behavior |
|-------|-------|-------------|----------|
| Claude Code | Global | `~/.claude/settings.json` | Works in any repo (uses agent's cwd) |
| Cursor | Project | `.cursor/mcp.json` | Repo-specific (uses `--path`) |
| Windsurf | Global | `~/.codeium/windsurf/mcp_config.json` | Works in any repo |

Restart your agent after setup. It will automatically discover 9 new memory tools.

### 3. Run the Daemon (Optional)

The daemon watches git for new commits and auto-updates memories + staleness in the background:

```bash
node packages/cli/dist/index.js watch --path /path/to/your/repo
```

This runs the MCP server AND the git watcher together. Without the daemon, you can use `serve` for MCP-only mode and manually run `init` to catch up on new commits.

### 5. Enable Semantic Search (Optional)

Install [Ollama](https://ollama.com) and pull the embedding model:

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama
ollama serve

# Pull the embedding model
ollama pull nomic-embed-text
```

CodeMemory auto-detects Ollama on `localhost:11434`. When available, all memories get vector embeddings and retrieval uses cosine similarity instead of keyword matching.

### 6. Use the CLI

```bash
# Check memory stats
codememory status --path /path/to/your/repo

# Search memories
codememory search "authentication flow" --path /path/to/your/repo
codememory search "database" --scope src/db/ --path /path/to/your/repo

# Manually add knowledge (personal by default)
codememory add "We use pnpm, not npm" --category convention --path /path/to/your/repo

# Add a team-shared memory (synced via git)
codememory add "Chose Prisma over Drizzle for migration tooling" -c decision -t team --path /path/to/your/repo

# Share a personal memory with the team
codememory share <memory-id> --path /path/to/your/repo

# See team memory status — authors, counts, sync state
codememory team --path /path/to/your/repo

# Delete a memory
codememory forget <memory-id> --path /path/to/your/repo
```

### What the Agent Sees

Once connected via MCP, the agent can call these tools mid-session:

```
Agent: "Let me check what I know about this project..."
→ calls get_context("project overview")
← Returns: architecture memories, conventions, recent changes

Agent: "What conventions should I follow here?"
→ calls get_conventions()
← Returns: "Use barrel exports", "snake_case for DB columns", etc.

Agent: "Why was this approach chosen?"
→ calls get_decisions(scope: "src/auth/")
← Returns: "Chose JWT over sessions because of mobile app statelessness"

Agent: "I learned something useful about this codebase"
→ calls remember("Error handling uses Result<T> pattern, not try-catch", category: "convention")
← Stored for future sessions (personal by default)

Agent: "This should be shared with the whole team"
→ calls remember("All API responses use Result<T> wrapper", category: "convention", tier: "team")
← Stored + written to shared.jsonl (syncs via git push/pull)

Agent: "Who on the team knows about payments?"
→ calls who_knows("payment processing")
← Returns: [{author: "Alice", memories: 5, topMemory: "Stripe webhook handler..."}, ...]

Agent: "This memory seems outdated"
→ calls mark_stale(memory_id: "abc-123")
← Memory downranked in future queries
```

Every memory the agent stores persists across sessions. Next time any agent connects to this repo — even a different agent (Cursor instead of Claude Code) — it picks up right where the last one left off.

**Team memories** go further: when you `git push`, your team-shared memories travel with the code. Teammates `git pull` and their agents automatically pick up the new knowledge.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Your Repository                           │
│                                                                  │
│   Git commits ───→ ┌────────────────────────────────────┐       │
│   File changes ──→ │          CodeMemory Daemon          │       │
│                    │                                      │       │
│                    │  ┌────────────┐  ┌───────────────┐  │       │
│                    │  │    Git     │  │   Staleness    │  │       │
│                    │  │ Extractor  │  │    Engine      │  │       │
│                    │  └─────┬──────┘  └───────┬───────┘  │       │
│                    │        │                  │          │       │
│                    │        ▼                  ▼          │       │
│                    │  ┌─────────────────────────────┐    │       │
│                    │  │     MemoryDatabase (SQLite)  │    │       │
│                    │  │  memories | files | commits  │    │       │
│                    │  └─────────────┬───────────────┘    │       │
│                    │                │                     │       │
│                    │        ┌───────┴──────┐             │       │
│                    │        │   Retriever  │             │       │
│                    │        │ (multi-signal│             │       │
│                    │        │   ranking)   │             │       │
│                    │        └───────┬──────┘             │       │
│                    │                │                     │       │
│                    │        ┌───────┴──────┐             │       │
│                    │        │  MCP Server  │◄── Agent    │       │
│                    │        └──────────────┘    queries  │       │
│                    └────────────────────────────────────┘       │
│                                                                  │
│   .codememory/                                                   │
│   ├── memory.db          SQLite database (gitignored)            │
│   ├── shared.jsonl       Team memories (committed to git)        │
│   └── .gitignore         Ignores memory.db, allows shared.jsonl  │
└──────────────────────────────────────────────────────────────────┘
              ↕ MCP Protocol (stdio)
┌──────────────────────────────────────────────────────────────────┐
│       Any MCP-compatible agent                                   │
│       Claude Code  ·  Cursor  ·  Copilot  ·  Custom agents      │
└──────────────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
codememory/
├── packages/
│   ├── core/                 Memory engine
│   │   └── src/
│   │       ├── types.ts              All types and config
│   │       ├── index.ts              CodeMemory class (main entry)
│   │       ├── store/
│   │       │   ├── database.ts       SQLite store (better-sqlite3)
│   │       │   └── embeddings.ts     Ollama embedding provider
│   │       ├── extractor/
│   │       │   └── git-extractor.ts  Commit parser + memory extraction
│   │       ├── staleness/
│   │       │   └── staleness-engine.ts   Auto-invalidation engine
│   │       ├── retrieval/
│   │       │   └── retriever.ts      Multi-signal ranking
│   │       └── sync/
│   │           └── team-sync.ts      Team memory sync via shared.jsonl
│   ├── mcp-server/           Agent interface
│   │   └── src/
│   │       ├── server.ts             MCP server (stdio transport)
│   │       └── tools/
│   │           └── memory-tools.ts   14 tool definitions
│   └── cli/                  Developer interface
│       └── src/
│           ├── index.ts              Commander CLI entry
│           └── commands/
│               ├── init.ts           Scan repo, build initial memory
│               ├── watch.ts          Daemon (git watcher + MCP server)
│               ├── status.ts         Memory stats
│               ├── search.ts         Query memories
│               ├── add.ts            Manual memory creation (with --tier)
│               ├── forget.ts         Delete a memory
│               ├── share.ts          Promote personal → team
│               └── team.ts           Team status (authors, counts)
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Dependency graph:** `cli → mcp-server → core`

## Core Concepts

### Memory

A memory is a single piece of knowledge about the project. Every memory has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID, auto-generated |
| `content` | `string` | The knowledge itself (human-readable text) |
| `category` | `MemoryCategory` | One of 5 types (see below) |
| `source` | `MemorySource` | `git`, `agent`, or `manual` |
| `tier` | `MemoryTier` | `personal` (local only) or `team` (synced via git) |
| `author` | `string` | Who created this memory (git user.name) |
| `relatedFiles` | `string[]` | File paths this memory is about |
| `commitSha` | `string \| null` | Commit that produced this memory |
| `staleness` | `number` | 0.0 (fresh) to 1.0 (fully stale) |
| `confidence` | `number` | 0.0 to 1.0, how certain we are |
| `embedding` | `number[] \| null` | Vector for semantic search |
| `tags` | `string[]` | Free-form labels |
| `createdAt` | `string` | ISO timestamp |
| `validatedAt` | `string` | Last time this memory was confirmed valid |

### Memory Categories

| Category | Purpose | Example | Typical Staleness |
|----------|---------|---------|-------------------|
| `architecture` | How the system is structured | "Auth module uses JWT with refresh tokens" | Medium |
| `convention` | Team rules and patterns | "We use snake_case for DB columns" | Low |
| `decision` | Why something was chosen | "Chose Prisma over Drizzle for migration tooling" | Low |
| `correction` | Things NOT to do | "Don't use `any` type in this repo" | Low |
| `active_context` | Temporary state | "Currently migrating from REST to GraphQL" | High |

### Memory Sources

| Source | How it enters | Confidence |
|--------|---------------|------------|
| `git` | Auto-extracted from commit messages and diffs | 0.5–0.8 |
| `agent` | Agent calls `remember` via MCP | 0.9 |
| `manual` | User runs `codememory add` or edits config | 0.9 |

## Component Architecture

### 1. GitExtractor (`core/src/extractor/git-extractor.ts`)

Parses git history to automatically create memories. Uses `simple-git` to interface with the repository.

**Extraction pipeline:**

```
New commit arrives
  ├── Parse commit message with heuristic pattern matchers
  │   ├── isArchitecturalCommit()  → "restructure", "add service", "split into"
  │   ├── isMigrationCommit()      → "migrate", "switch from", "deprecate"
  │   ├── isConventionCommit()     → "lint", "enforce rule", "eslint"
  │   └── extractDecision()        → "because", "instead of", "chose"
  ├── Check file count (>10 files = refactor)
  ├── Auto-tag from keywords (auth, api, database, security, etc.)
  └── Emit ExtractedMemory[] with category, files, tags, confidence
```

**Key methods:**
- `getRecentCommits(since?)` — fetch commit log via simple-git
- `getCommitFiles(sha)` — list files changed in a commit via `diff-tree`
- `extractFromCommit(commit)` — run all heuristics, return memories
- `getFileHash(path)` — get current git object hash for staleness tracking
- `getTrackedFiles()` — list all files tracked by git

**Design choice:** Pure heuristics, no LLM dependency. Fast, free, works offline. LLM-powered extraction is a planned future enhancement for deeper commit analysis.

### 2. MemoryDatabase (`core/src/store/database.ts`)

SQLite storage via `better-sqlite3`. All data lives in a single `memory.db` file inside `.codememory/`.

**Schema (3 tables):**

```sql
-- Core knowledge store
memories (
  id, content, category, source, tier, author,
  tags, related_files, commit_sha, staleness, confidence,
  embedding, created_at, updated_at, validated_at
)

-- File hash tracking for staleness detection
tracked_files (path, hash, last_modified)

-- Commit processing state
tracked_commits (sha, message, author, date, files, processed)
```

**Indexes:** `category`, `staleness`, `commit_sha`, `tier`, `author`

**Design choices:**
- WAL journal mode for concurrent reads during daemon operation
- JSON-serialized arrays for `tags` and `related_files` (simple, queryable with LIKE)
- Embeddings stored as BLOB (Float32Array buffer)
- `tracked_files` uses git object hashes — comparing hashes is how we detect changes

### 3. EmbeddingProvider (`core/src/store/embeddings.ts`)

Optional vector embeddings via local Ollama instance. Enables semantic search when available, falls back to keyword matching when not.

**Model:** `nomic-embed-text` (768 dimensions, good quality, runs locally)

**Flow:**
```
Text → Ollama /api/embed → Float32 vector → stored in memory.embedding
```

**Availability check:** On first call, pings `http://localhost:11434/api/tags` and checks if the model is pulled. Caches the result for the session.

**Design choice:** Local-only by default. No API keys, no network calls, no cost. The system works without embeddings — retrieval falls back to keyword matching.

### 4. StalenessEngine (`core/src/staleness/staleness-engine.ts`)

The differentiator. Auto-invalidates memories when the files they reference change.

**How it works:**

```
On git event (commit/pull):
  1. Get list of changed files
  2. For each changed file:
     a. Find all memories where relatedFiles contains this file
     b. Compare current file hash vs tracked hash
     c. If different → score the change magnitude:
        - File deleted?          → staleness = 1.0 (hard stale)
        - Config file changed?   → staleness += 0.7
        - Source file changed?   → staleness += 0.4
        - Doc file changed?      → staleness += 0.2
        - Test file changed?     → staleness += 0.1
        - Generated file?        → staleness += 0.0 (ignore)
     d. Update memory staleness score
     e. Update tracked file hash
  3. Stale memories are downranked in retrieval, NOT deleted
```

**Staleness scale:**
- `0.0` — freshly created or confirmed
- `0.0–0.5` — probably still valid
- `0.6+` — flagged as stale (configurable threshold)
- `1.0` — fully stale (referenced file deleted)

**Recovery:** Agent or user can call `confirm_memory` to reset staleness to 0.0, or `mark_stale` to force 1.0.

### 5. TeamSync (`core/src/sync/team-sync.ts`)

Syncs team memories between developers via a shared JSONL file committed to git.

**Architecture:**

```
.codememory/
├── memory.db       ← local SQLite (gitignored) — all memories
└── shared.jsonl    ← team memories (committed to git) — sync file
```

**JSONL format:** One JSON object per line. Each line is a `SharedMemoryEntry`. Git-friendly: append-only, readable diffs, `git blame` shows who added what.

**Key methods:**
- `share(memoryId)` — promote personal → team, update DB tier, append to shared.jsonl
- `importFromShared()` — read shared.jsonl, insert new entries (INSERT OR IGNORE by id)
- `exportToShared()` — rebuild shared.jsonl from all team memories in DB
- `sharedCount()` — count entries in shared.jsonl

**Team sync flow:**

```
Developer A:
  1. Agent calls remember("Uses Result<T> pattern", tier: "team")
  2. Memory stored in local memory.db with tier='team'
  3. Memory appended to .codememory/shared.jsonl
  4. Developer does git add + commit + push

Developer B:
  1. Does git pull (shared.jsonl updated)
  2. Agent calls sync_team (or daemon auto-imports on git event)
  3. TeamSync.importFromShared() reads shared.jsonl
  4. New entries inserted into local memory.db
  5. Developer B's agent now has Developer A's team memories

Who-Knows flow:
  1. Agent calls who_knows("payment processing")
  2. Retriever queries with limit=50, filters tier='team'
  3. Groups results by author, ranks by count + top score
  4. Returns: [{author: "Alice", memories: 5, topMemory: "..."}]
```

**Design choices:**
- JSONL over SQLite for sync: text-based, git-mergeable, no binary conflicts
- INSERT OR IGNORE: idempotent imports, safe to re-import
- Personal memories never leave the machine unless explicitly shared
- Auto-detect git author via `git config user.name` for attribution

### 6. MemoryRetriever (`core/src/retrieval/retriever.ts`)

Multi-signal ranking system. Scores each candidate memory and returns top-K.

**Scoring formula:**

```
Score = 0.40 × semantic_similarity      (embedding cosine or keyword fallback)
      + 0.25 × file_proximity           (same directory as query scope)
      + 0.20 × recency                  (exponential decay, 30-day half-life)
      + 0.15 × confidence               (source-based confidence score)
      − staleness × 0.5                 (penalty for stale memories)
```

**Signal breakdown:**

| Signal | Weight | Method | Fallback |
|--------|--------|--------|----------|
| Semantic | 0.40 | Cosine similarity on embeddings | Keyword overlap (word-in-content count / query word count) |
| File proximity | 0.25 | % of relatedFiles matching scope prefix | 0.5 (neutral) when no scope |
| Recency | 0.20 | `e^(-ageDays / 30)` | Always available |
| Confidence | 0.15 | Raw confidence value from memory | Always available |
| Staleness penalty | −0.5× | `staleness × 0.5` subtracted from score | Always available |

**Filtering:**
- By tier (`personal` or `team`)
- By category (optional)
- By scope (directory prefix on relatedFiles)
- Stale memories excluded by default (configurable)

### 7. CodeMemory (`core/src/index.ts`)

Main facade class. Wires all components together and exposes the public API.

```typescript
const cm = new CodeMemory('/path/to/repo', { /* optional config overrides */ });

await cm.init();                          // Scan repo, build initial memory
await cm.processNewCommits();             // Process new commits since last run
await cm.query('auth flow', 'src/auth/'); // Multi-signal retrieval
await cm.remember('Uses JWT', 'architecture', ['src/auth/']);
await cm.remember('Team uses pnpm', 'convention', [], [], 'team'); // Team memory
cm.share(memoryId);                       // Promote personal → team
cm.syncTeam();                            // Import from shared.jsonl
cm.getTeamAuthors();                      // [{author, count}]
await cm.whoKnows('auth');                // Who has context about auth?
await cm.getConventions();                // All convention memories
await cm.getDecisions('src/api/');        // Decisions for a module
cm.confirm(memoryId);                     // Reset staleness
cm.markStale(memoryId);                   // Force stale
cm.forget(memoryId);                      // Delete
cm.stats();                               // { total, fresh, stale, team, personal }
cm.close();                               // Close DB connection
```

**Init flow:**
1. Ensure `.codememory/.gitignore` (gitignore memory.db, allow shared.jsonl)
2. Import team memories from `shared.jsonl` (if exists)
3. List all git-tracked files, store hashes in `tracked_files`
4. Fetch commits from last 90 days
5. Run extraction pipeline on each commit (stored as team tier)
6. Export team memories to `shared.jsonl`
7. Generate embeddings for all new memories (if Ollama available)

**processNewCommits flow:**
1. Import new team memories from `shared.jsonl` (teammate may have pushed)
2. Get unprocessed commits from `tracked_commits`
3. Extract memories from each (team tier)
4. Run staleness engine on all changed files
5. Export updated team memories to `shared.jsonl`
6. Generate embeddings for new memories

## MCP Server (`mcp-server/src/`)

Exposes CodeMemory to any MCP-compatible agent over stdio transport. Uses `@modelcontextprotocol/sdk`.

### MCP Tools (14 total)

**Retrieval (4 tools):**

| Tool | Input | Returns |
|------|-------|---------|
| `get_context` | `query`, `scope?`, `limit?`, `tier?` | Ranked memories with scores, tier, author |
| `get_conventions` | *(none)* | All convention memories |
| `get_decisions` | `scope?` | Architectural decisions for a module |
| `get_recent_changes` | `days?` (default: 7) | Memories created in last N days |

**Writing (2 tools):**

| Tool | Input | Effect |
|------|-------|--------|
| `remember` | `content`, `category`, `related_files?`, `tags?`, `tier?` | Stores new memory (personal or team) |
| `correct_memory` | `memory_id`, `correction` | Replaces memory content |

**Feedback (2 tools):**

| Tool | Input | Effect |
|------|-------|--------|
| `mark_stale` | `memory_id` | Sets staleness to 1.0 |
| `confirm_memory` | `memory_id` | Resets staleness to 0.0 |

**Status (1 tool):**

| Tool | Input | Returns |
|------|-------|---------|
| `memory_status` | *(none)* | `{ total, fresh, stale, team, personal }` |

**Team (5 tools):**

| Tool | Input | Returns/Effect |
|------|-------|----------------|
| `share_memory` | `memory_id` | Promotes personal → team, writes to shared.jsonl |
| `who_knows` | `query` | Authors ranked by relevant team memories |
| `get_team_context` | `query`, `limit?` | Team-only memories with author attribution |
| `team_status` | *(none)* | Team overview: authors, memory counts |
| `sync_team` | *(none)* | Imports new team memories from shared.jsonl |

### Agent Integration

Run `codememory setup` to auto-configure. Supports Claude Code, Cursor, and Windsurf.

A typical agent session after setup:

```
1. Agent starts → calls get_context("what is this project?")
2. Agent reads conventions → calls get_conventions()
3. Agent works on auth module → calls get_context("auth", scope: "src/auth/")
4. Agent learns something → calls remember("Uses bcrypt for hashing", "convention")
5. Agent finds stale memory → calls mark_stale(memory_id)
```

## CLI (`cli/src/`)

Developer-facing interface. Built with Commander.js.

| Command | Description |
|---------|-------------|
| `codememory setup` | Auto-configure with AI agents + init if needed |
| `codememory init` | Scan repo, extract memories from last 90 days of commits |
| `codememory watch` | Start daemon: git watcher + MCP server |
| `codememory serve` | Start MCP server only (no watching) |
| `codememory status` | Show memory stats |
| `codememory search <query>` | Query memories from terminal |
| `codememory add <content>` | Manually store a memory (`-t team` for shared) |
| `codememory forget <id>` | Delete a memory |
| `codememory share <id>` | Promote a personal memory to team |
| `codememory team` | Show team memory status, authors, sync state |

All commands accept `--path <path>` to specify the repository (defaults to `.`).

## Data Flow

### Write Path (Memory Creation)

```
Source          │  How                              │  Stored As
────────────────┼───────────────────────────────────┼──────────────
Git commit      │  GitExtractor.extractFromCommit() │  source: 'git'
Agent MCP call  │  remember tool → cm.remember()    │  source: 'agent'
CLI command     │  codememory add → cm.remember()    │  source: 'manual'
                │                                   │
                ▼                                   ▼
        MemoryDatabase.insertMemory()       EmbeddingProvider.embed()
                │                                   │
                └──────────── memory.db ◄───────────┘
```

### Read Path (Memory Retrieval)

```
Agent query: get_context("auth flow", scope: "src/auth/")
    │
    ▼
MemoryRetriever.query()
    │
    ├── 1. Load candidates from SQLite (filter by category/scope)
    ├── 2. Compute query embedding (Ollama or skip)
    ├── 3. Score each candidate:
    │       semantic × 0.40 + proximity × 0.25 + recency × 0.20 + confidence × 0.15 − staleness
    ├── 4. Sort by score descending
    └── 5. Return top-K
```

### Staleness Path (Auto-Invalidation)

```
Git commit with changed files
    │
    ▼
StalenessEngine.processChangedFiles()
    │
    ├── For each changed file:
    │   ├── Find memories referencing this file (LIKE query)
    │   ├── Compare current hash vs tracked hash
    │   ├── Score change magnitude by file type
    │   └── Update memory.staleness += delta
    │
    └── Update tracked_files with new hashes
```

### Team Sync Path

```
Developer A stores team memory:
    │
    ├── cm.remember(content, category, files, tags, 'team')
    │       │
    │       ├── Insert into local memory.db with tier='team'
    │       └── team.exportToShared() → write to shared.jsonl
    │
    └── git add .codememory/shared.jsonl && git commit && git push

Developer B syncs:
    │
    ├── git pull  (shared.jsonl updated)
    │
    ├── cm.syncTeam()  or  daemon auto-detects git event
    │       │
    │       └── team.importFromShared()
    │               │
    │               ├── Read shared.jsonl line-by-line
    │               ├── For each entry: INSERT OR IGNORE by id
    │               └── Return count of newly imported memories
    │
    └── Developer B's agent now has Developer A's team memories
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Language | TypeScript (ESM) | MCP SDK is TypeScript, npm ecosystem, widest dev reach |
| Monorepo | pnpm workspaces + Turborepo | Fast builds, workspace linking |
| Database | SQLite via better-sqlite3 | Zero infra, file-based, lives in repo |
| Git | simple-git | Well-maintained Node.js git wrapper |
| Embeddings | Ollama (nomic-embed-text) | Free, private, offline, no API keys |
| MCP | @modelcontextprotocol/sdk | Official MCP TypeScript SDK |
| CLI | Commander.js | Standard Node.js CLI framework |
| File watching | chokidar | Reliable cross-platform file watcher |

## Configuration

Default config (overridable per-repo via constructor or `.codememory/config.yaml`):

```typescript
{
  storageDir: '.codememory',            // Where memory.db lives
  localEmbeddings: true,                // Use Ollama for embeddings
  embeddingModel: 'nomic-embed-text',   // Embedding model name
  ollamaHost: 'http://localhost:11434', // Ollama API endpoint
  stalenessThreshold: 0.6,             // Auto-flag stale at this level
  defaultLimit: 10,                     // Max results per query
  author: 'unknown',                      // Auto-detected from git config user.name
  ignorePatterns: [                     // Files to skip during tracking
    'node_modules/**', 'dist/**', '.git/**',
    '*.lock', '*.min.js', '*.min.css',
    'coverage/**',
  ],
}
```

## Design Decisions

### Why SQLite (not PostgreSQL, not JSON files)?
- Zero infrastructure — no server to run, no Docker container
- File-based — lives inside the repo, portable
- WAL mode — safe for concurrent reads from daemon + CLI
- Fast enough — memory stores are small (thousands, not millions)
- better-sqlite3 — synchronous API, no async overhead for DB calls

### Why manual fromJson (not json_serializable)?
- Full control over parsing — handle missing fields, type coercion, defaults
- No extra codegen step
- Memories have simple flat structures — a schema library adds no value

### Why heuristic extraction (not LLM)?
- Zero cost — no API calls per commit
- Zero latency — pattern matching is instant
- Works offline — no network dependency
- Deterministic — same commit always produces same memories
- LLM extraction is planned as an optional `--deep` flag

### Why local embeddings (not OpenAI API)?
- Free — no per-query cost
- Private — code context never leaves the machine
- Offline — works without internet
- Fast — Ollama runs efficiently on Apple Silicon

### Why stale-not-delete?
- Stale memories might become valid again after a revert
- Agents can confirm stale memories if they verify them
- Deletion is irreversible — staleness is a soft signal
- Audit trail — can see what was once known

## Roadmap

### v0.2 — Enhanced Extraction
- [ ] LLM-powered extraction (`--deep` flag) for richer memories from commits
- [ ] Parse PR descriptions and code review comments
- [ ] File-level summaries (what each file does)

### v0.3 — Team Features (DONE)
- [x] Team memory tier with shared.jsonl sync via git
- [x] Per-author memory attribution (auto-detected from git)
- [x] `who_knows` — find team experts on a topic
- [x] `share`, `sync_team`, `team_status` MCP tools
- [x] CLI: `share`, `team`, `add --tier team`
- [ ] Memory merge conflict resolution (JSONL minimizes but doesn't eliminate)

### v0.4 — Observability
- [ ] Web dashboard for memory inspection
- [ ] Memory timeline visualization
- [ ] Staleness reports and alerts

### v0.5 — Cross-Agent
- [ ] LSP extension for Cursor/VS Code
- [ ] Export/import for agent migration
- [ ] Memory deduplication across sources
