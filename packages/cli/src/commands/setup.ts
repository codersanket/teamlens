import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface McpServerConfig {
  command: string;
  args: string[];
}

interface HookEntry {
  command: string;
  type: string;
}

interface HookRule {
  hooks: HookEntry[];
  matcher: string;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  hooks?: Record<string, HookRule[]>;
  [key: string]: unknown;
}

/** Resolve the absolute path to the CLI entry point (works for global + local installs). */
function getCliPath(): string {
  return path.resolve(
    new URL('.', import.meta.url).pathname,
    '..',    // dist/
    '..',    // cli/
    'dist',
    'index.js'
  );
}

// ── Agent Configs ──

type ConfigScope = 'global' | 'project';

interface AgentTarget {
  name: string;
  scope: ConfigScope;
  detect: () => string | null;
  read: (configPath: string) => McpConfig;
  write: (configPath: string, config: McpConfig) => void;
  supportsHooks: boolean;
}

function getAgents(repoPath: string): AgentTarget[] {
  return [
    // Claude Code — global ~/.claude/settings.json
    {
      name: 'Claude Code',
      scope: 'global' as ConfigScope,
      supportsHooks: true,
      detect: () => {
        const configPath = path.join(os.homedir(), '.claude', 'settings.json');
        return fs.existsSync(path.join(os.homedir(), '.claude')) ? configPath : null;
      },
      read: (configPath) => {
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      },
      write: (configPath, config) => {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      },
    },

    // Cursor — project-level .cursor/mcp.json
    {
      name: 'Cursor',
      scope: 'project' as ConfigScope,
      supportsHooks: false,
      detect: () => {
        const cursorDir = path.join(repoPath, '.cursor');
        if (fs.existsSync(cursorDir)) {
          return path.join(cursorDir, 'mcp.json');
        }
        return null;
      },
      read: (configPath) => {
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      },
      write: (configPath, config) => {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      },
    },

    // Windsurf — global ~/.codeium/windsurf/mcp_config.json
    {
      name: 'Windsurf',
      scope: 'global' as ConfigScope,
      supportsHooks: false,
      detect: () => {
        const configPath = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
        return fs.existsSync(path.join(os.homedir(), '.codeium', 'windsurf')) ? configPath : null;
      },
      read: (configPath) => {
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      },
      write: (configPath, config) => {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      },
    },
  ];
}

export async function setupCommand(repoPath: string): Promise<void> {
  const cliPath = getCliPath();

  console.log('\n  TeamLens Setup\n');

  // Verify the serve entry point exists
  if (!fs.existsSync(cliPath)) {
    console.error(`  Error: CLI not built. Run \`pnpm build\` first.`);
    console.error(`  Expected: ${cliPath}`);
    process.exit(1);
  }

  // ── MCP Server Config ──
  // No --path: the serve command auto-detects from CWD.
  // Claude Code sets CWD to the project directory, so it just works.
  const mcpEntry: McpServerConfig = {
    command: 'node',
    args: [cliPath, 'serve'],
  };

  // For project-scoped agents (Cursor), include --path for the specific repo
  const projectMcpEntry: McpServerConfig = {
    command: 'node',
    args: [cliPath, 'serve', '--path', repoPath],
  };

  // ── Hook Config ──
  // PostToolUse hook logs activity automatically.
  // No --path: hook-log auto-detects from CWD, skips if no .teamlens/ exists.
  const hookCommand = `node ${cliPath} hook-log`;

  const agents = getAgents(repoPath);
  let configured = 0;

  for (const agent of agents) {
    const configPath = agent.detect();
    if (!configPath) continue;

    const entry = agent.scope === 'global' ? mcpEntry : projectMcpEntry;

    try {
      const config = agent.read(configPath);

      // Register MCP server
      config.mcpServers = config.mcpServers ?? {};
      const action = config.mcpServers['teamlens'] ? 'updated' : 'configured';
      config.mcpServers['teamlens'] = entry;

      // Register hooks (Claude Code only)
      if (agent.supportsHooks) {
        config.hooks = config.hooks ?? {};
        const existingPostHooks = config.hooks['PostToolUse'] ?? [];

        // Remove any existing teamlens hook entries (idempotent)
        const filteredHooks = existingPostHooks.filter(rule =>
          !rule.hooks?.some(h => h.command.includes('hook-log'))
        );

        // Add our hook
        filteredHooks.push({
          hooks: [{ command: hookCommand, type: 'command' }],
          matcher: '',
        });
        config.hooks['PostToolUse'] = filteredHooks;
      }

      agent.write(configPath, config);

      const scopeLabel = agent.scope === 'global' ? '(global — works in any project)' : '(project-level)';
      console.log(`  ${agent.name}: ${action} ${scopeLabel}`);
      console.log(`    ${configPath}`);

      configured++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${agent.name}: failed — ${message}`);
    }
  }

  if (configured === 0) {
    console.log('  No supported AI agents detected.\n');
    console.log('  Supported: Claude Code, Cursor, Windsurf');
    console.log('  Install one, then run `teamlens setup` again.\n');
    console.log('  Or manually add to your agent\'s MCP config:\n');
    console.log(JSON.stringify({ mcpServers: { teamlens: mcpEntry } }, null, 2));
    return;
  }

  console.log(`\n  ${configured} agent(s) configured.\n`);

  // ── Init project ──
  const storageDir = path.join(repoPath, '.teamlens');
  const { TeamLens } = await import('@teamlens/core');
  const tl = await TeamLens.create(repoPath);

  try {
    if (!fs.existsSync(storageDir)) {
      console.log('  Initializing memory store...\n');
      const { memoriesCreated, filesTracked } = await tl.init();
      console.log(`    Files tracked:    ${filesTracked}`);
      console.log(`    Memories created: ${memoriesCreated}`);
      console.log(`    Storage:          ${storageDir}/`);
    } else {
      console.log('  Memory store already exists.');
    }

    // Generate CLAUDE.md + other agent config files
    console.log('\n  Generating agent instruction files...');
    const { generated, warnings } = tl.distribute();
    for (const file of generated) {
      console.log(`    ${file}`);
    }
    for (const warning of warnings) {
      console.log(`    Warning: ${warning}`);
    }
  } finally {
    tl.close();
  }

  console.log('\n  Done. Restart your AI agent to activate TeamLens.\n');
  console.log('  What happens next:');
  console.log('    1. Open your AI agent (Claude Code, Cursor, etc.) in this project');
  console.log('    2. TeamLens auto-starts and tracks your session');
  console.log('    3. Activity is logged automatically via hooks');
  console.log('    4. AI shares insights when it learns something (per CLAUDE.md instructions)');
  console.log('    5. Run `teamlens dashboard` to see everything\n');
}
