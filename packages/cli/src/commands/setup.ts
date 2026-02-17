import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface McpServerConfig {
  command: string;
  args: string[];
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

/** Resolve the absolute path to the CLI entry point. */
function getServePath(): string {
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
}

function getAgents(repoPath: string): AgentTarget[] {
  return [
    // Claude Code — global ~/.claude/settings.json
    {
      name: 'Claude Code',
      scope: 'global' as ConfigScope,
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
  const servePath = getServePath();

  console.log('TeamLens Setup\n');

  // Verify the serve entry point exists
  if (!fs.existsSync(servePath)) {
    console.error(`  Error: CLI not built. Run \`pnpm build\` first.`);
    console.error(`  Expected: ${servePath}`);
    process.exit(1);
  }

  // Global agents: no --path (serve defaults to cwd, which is the project the agent opens)
  // Project agents: use --path with the specific repo
  const globalMcpEntry: McpServerConfig = {
    command: 'node',
    args: [servePath, 'serve'],
  };

  const projectMcpEntry: McpServerConfig = {
    command: 'node',
    args: [servePath, 'serve', '--path', repoPath],
  };

  const agents = getAgents(repoPath);
  let configured = 0;

  for (const agent of agents) {
    const configPath = agent.detect();
    if (!configPath) continue;

    const mcpEntry = agent.scope === 'global' ? globalMcpEntry : projectMcpEntry;

    try {
      const config = agent.read(configPath);
      config.mcpServers = config.mcpServers ?? {};

      const action = config.mcpServers['teamlens'] ? 'updated' : 'configured';
      config.mcpServers['teamlens'] = mcpEntry;
      agent.write(configPath, config);

      const scopeLabel = agent.scope === 'global' ? '(global — works in any repo)' : '(project-level)';
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
    console.log(JSON.stringify({ mcpServers: { teamlens: globalMcpEntry } }, null, 2));
    return;
  }

  console.log(`\n  ${configured} agent(s) configured.`);
  console.log('  Restart your agent to pick up the new tools.');

  // Auto-init if .teamlens doesn't exist in this repo
  const storageDir = path.join(repoPath, '.teamlens');
  const { TeamLens } = await import('@teamlens/core');
  const tl = await TeamLens.create(repoPath);

  try {
    if (!fs.existsSync(storageDir)) {
      console.log('\n  No memory store found — initializing...\n');
      const { memoriesCreated, filesTracked } = await tl.init();
      console.log(`  Files tracked:    ${filesTracked}`);
      console.log(`  Memories created: ${memoriesCreated}`);
      console.log(`  Storage:          ${storageDir}/`);
    }

    // Always distribute to ensure CLAUDE.md exists with session protocol
    console.log('\n  Generating agent config files...');
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

  console.log('\n  You\'re all set.\n');
}
