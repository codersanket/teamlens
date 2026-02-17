# TeamLens

**See what your team's AI is actually doing — and make every developer's AI smarter because of it.**

TeamLens is an AI Team Intelligence platform that gives companies visibility into their AI coding tool investment and lets developers learn from each other's AI sessions.

It runs as an [MCP server](https://modelcontextprotocol.io/) that auto-starts with your AI tools (Claude Code, Cursor, Windsurf), silently tracks sessions and insights, and surfaces everything through a local web dashboard.

## The Problem

- Companies spend thousands per month on AI coding tools with **zero visibility** into what they produce
- AI sessions are private and ephemeral — knowledge dies with the session
- Developer A discovers a gotcha, Developer B hits the same gotcha the next day
- Everyone starts every AI session from zero

## How It Works

```
Developer runs `teamlens setup` → done.

Next time they open Claude Code / Cursor:
  1. TeamLens MCP server auto-starts
  2. Session tracking begins automatically
  3. AI gets team context ("Your teammate discovered...")
  4. Activity is logged automatically via hooks
  5. AI shares insights when it learns something
  6. Everything shows up on the dashboard
```

**Zero friction. No manual tracking. It just works.**

## Quick Start

```bash
# Install
npm install -g teamlens

# Set up in your project
cd my-project
teamlens setup

# Open the dashboard
teamlens dashboard
```

`teamlens setup` automatically:
- Registers the MCP server with Claude Code / Cursor / Windsurf
- Sets up activity tracking hooks (Claude Code)
- Initializes the memory store from git history
- Generates `CLAUDE.md` with instructions for your AI to share insights

Restart your AI agent and TeamLens is active.

## Dashboard

```bash
teamlens dashboard
```

Opens a local web dashboard at `localhost:3847`:

- **Overview** — sessions today, total insights, active developers, ROI metrics
- **Sessions** — who's using AI, how long, what files they touched
- **Insights Feed** — what the team's AI is learning, filterable by type and author
- **Contributors** — leaderboard ranked by impact score
- **Analytics** — usage trends, insight breakdown, hot files

No cloud. No auth needed. Reads from a local SQLite database.

## What Gets Tracked

| Signal | How | Automatic? |
|--------|-----|:----------:|
| **Sessions** | MCP server auto-creates on startup | Yes |
| **Activities** | PostToolUse hooks log file edits and commands | Yes |
| **Insights** | AI calls `share_insight` when it learns something | Yes |
| **Team sync** | `team.jsonl` committed to git | Yes |

## Team Sync

Knowledge flows through git — no cloud dependency:

```
.teamlens/
├── memory.db       ← local SQLite (gitignored)
└── team.jsonl      ← shared insights (committed to git)
```

When a developer's AI shares an insight:
1. Stored in the local database
2. Appended to `team.jsonl`
3. Auto-committed and pushed to git
4. Available to teammates on next session (auto-pulled)

Teammates' AI sessions automatically get context from the whole team's discoveries.

## CLI Commands

```
teamlens setup                 Configure AI agents + initialize project
teamlens dashboard             Open web dashboard (localhost:3847)
teamlens status                Quick stats in terminal
teamlens feed                  View insights feed in terminal
teamlens search <query>        Search team knowledge
teamlens add <content>         Manually add a memory
teamlens share <id>            Share a personal memory with the team
teamlens rule add <content>    Add a team AI rule
teamlens rule list             List all rules
teamlens distribute            Generate agent config files
teamlens serve                 Start MCP server (usually auto-started)
teamlens watch                 Watch git changes + MCP server
```

## MCP Tools

When the MCP server is running, your AI agent has access to:

| Tool | Description |
|------|-------------|
| `share_insight` | Share a learning with the team (auto-categorized) |
| `ask` | Query team knowledge |
| `log_activity` | Record what you're doing |
| `analytics` | Get ROI metrics and trends |
| `status` | Session state and stats |
| `who_knows` | Find who has context on a topic |
| `get_conventions` | Get team conventions |
| `get_rules` | Get active rules |
| `add_rule` | Add a team rule |
| `distribute_rules` | Generate config files |
| `start_session` | Start session with task context (optional) |
| `end_session` | End session with summary |

## Rules & Governance

Define team-wide rules that get distributed to all AI agent configs:

```bash
# Add a convention
teamlens rule add "Always use snake_case for database columns" \
  --category convention --scope "src/db/**" --priority high

# Add with examples
teamlens rule add "Use early returns instead of nested ifs" \
  --category convention \
  --good "if (!valid) return;" \
  --bad "if (valid) { ... deep nesting ... }"

# Distribute to agent config files
teamlens distribute
# Generates: CLAUDE.md, .cursor/rules/, AGENTS.md, copilot-instructions.md
```

## Architecture

```
packages/
├── core/           @teamlens/core        — database, sessions, analytics, sync
├── mcp-server/     @teamlens/mcp-server  — MCP tools + resources
├── web/            @teamlens/web         — local web dashboard
└── cli/            teamlens              — CLI (npm install -g teamlens)
```

```
AI Agent (Claude Code / Cursor / Windsurf)
    ↕ stdio (MCP protocol)
TeamLens MCP Server (auto-started)
    ↕
SQLite (.teamlens/memory.db)
    ↕
team.jsonl (committed to git → synced across team)

Dashboard (localhost:3847)
    ↕
SQLite (same file, read-only)
```

## Supported AI Tools

| Tool | MCP Server | Activity Hooks | Config Generation |
|------|:----------:|:--------------:|:-----------------:|
| **Claude Code** | Yes | Yes | CLAUDE.md |
| **Cursor** | Yes | — | .cursor/rules/ |
| **Windsurf** | Yes | — | — |
| **GitHub Copilot** | — | — | copilot-instructions.md |

## Requirements

- Node.js >= 20
- Git (for team sync)

## Contributing

```bash
git clone https://github.com/sanketbabar/teamlens
cd teamlens
pnpm install
pnpm build
```

## License

MIT
