# TeamLens

**AI Team Intelligence** — see what your team's AI is actually doing, and make every developer's AI smarter because of it.

TeamLens runs as an MCP server that auto-starts with AI tools (Claude Code, Cursor, Windsurf), tracks sessions and insights, and surfaces everything through a local web dashboard.

## Quick Start

```bash
# Install dependencies and build
pnpm install && pnpm build

# Set up TeamLens in your repo
cd /path/to/your/repo
teamlens setup        # auto-configures your AI agents
teamlens init         # builds initial memory store
```

That's it. Next time you open Claude Code or Cursor, TeamLens auto-starts and begins tracking.

## How It Works

```
Developer opens AI agent
  → TeamLens MCP server auto-starts
  → Session begins on first interaction
  → AI gets team context injected ("Your teammate discovered...")
  → AI shares insights back to TeamLens
  → Session auto-ends when agent disconnects

Manager runs `teamlens dashboard`
  → Browser opens localhost:3847
  → Dashboard shows sessions, insights, ROI metrics, contributor leaderboard
```

## CLI Commands

```
teamlens setup              Configure MCP auto-start with AI agents
teamlens init               Initialize .teamlens/ memory store
teamlens serve              Start MCP server (usually auto-started)
teamlens watch              Watch git changes + run MCP server
teamlens dashboard          Open web dashboard (localhost:3847)
teamlens feed               Show team insights feed in terminal
teamlens status             Memory stats overview
teamlens search <query>     Search team knowledge
teamlens add <content>      Manually add a memory
teamlens forget <id>        Delete a memory
teamlens share <id>         Share a personal memory with the team
teamlens team               Show team memory status
teamlens rule add/list/enable/disable    Manage team AI rules
teamlens distribute         Generate agent config files (CLAUDE.md, etc.)
```

## MCP Tools

When connected to an AI agent, TeamLens exposes these tools:

| Tool | Purpose |
|------|---------|
| `start_session` | Optional — set task context (sessions auto-create) |
| `share_insight` | Share a learning with the team |
| `log_activity` | Record what you're doing (debug, refactor, etc.) |
| `end_session` | End session with summary |
| `ask` | Query team knowledge |
| `analytics` | ROI metrics, trends, contributors |
| `status` | Session state + stats overview |
| `get_conventions` | All project conventions |
| `who_knows` | Find who has context on a topic |
| `get_rules` | Active team AI rules |
| `add_rule` | Define a new team rule |
| `distribute_rules` | Generate agent config files |

## Web Dashboard

```bash
teamlens dashboard
```

Opens a local dashboard at `http://localhost:3847` with:

- **Overview** — session count, insights, ROI summary, top contributors
- **Sessions** — session list with duration, insights, files touched
- **Insights** — chronological feed, filterable by type/author/file
- **Contributors** — leaderboard ranked by impact score
- **Analytics** — usage trends, ROI metrics, insight type breakdown, hot files

## Architecture

```
packages/
├── core/           @teamlens/core        Database, sessions, analytics, sync
├── mcp-server/     @teamlens/mcp-server  MCP tools + resources
├── web/            @teamlens/web         Local web dashboard
└── cli/            teamlens              CLI commands
```

**Data flow:**
```
AI Agent ←→ MCP Server ←→ SQLite (.teamlens/memory.db) ←→ team.jsonl (git-synced)
                                       ↑
                              Web Dashboard (reads)
```

## Team Sync

Knowledge flows through git — no cloud dependency:

1. Developer's AI shares an insight via `share_insight`
2. Insight is stored in SQLite and exported to `team.jsonl`
3. `team.jsonl` is committed and pushed with normal git workflow
4. Teammates pull and their TeamLens auto-imports new insights
5. Next AI session gets team context injected automatically

## Requirements

- Node.js >= 20
- pnpm 9+

## Development

```bash
pnpm install       # install deps
pnpm build         # build all packages
pnpm dev           # watch mode
```

## License

MIT
