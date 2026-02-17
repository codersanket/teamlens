#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { initCommand } from './commands/init.js';
import { watchCommand } from './commands/watch.js';
import { statusCommand } from './commands/status.js';
import { searchCommand } from './commands/search.js';
import { addCommand } from './commands/add.js';
import { forgetCommand } from './commands/forget.js';
import { setupCommand } from './commands/setup.js';
import { shareCommand } from './commands/share.js';
import { teamCommand } from './commands/team.js';
import { ruleAddCommand, ruleListCommand, ruleEnableCommand, ruleDisableCommand } from './commands/rule.js';
import { distributeCommand } from './commands/distribute.js';
import { dashboardCommand } from './commands/dashboard.js';
import { feedCommand } from './commands/feed.js';

const program = new Command();

program
  .name('teamlens')
  .description('TeamLens — AI Team Intelligence platform')
  .version('0.1.0');

program
  .command('setup')
  .description('Auto-configure TeamLens with your AI agents (Claude Code, Cursor, Windsurf)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    await setupCommand(resolve(opts.path));
  });

program
  .command('init')
  .description('Scan repo and build initial memory store')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    await initCommand(resolve(opts.path));
  });

program
  .command('watch')
  .description('Start daemon — watches git changes + runs MCP server')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    await watchCommand(resolve(opts.path));
  });

program
  .command('serve')
  .description('Start MCP server only (no git watching)')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    const { startMcpServer } = await import('@teamlens/mcp-server');
    await startMcpServer(resolve(opts.path));
  });

program
  .command('status')
  .description('Show memory stats')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    await statusCommand(resolve(opts.path));
  });

program
  .command('search <query>')
  .description('Search memories')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-s, --scope <scope>', 'Narrow to directory scope')
  .action(async (query, opts) => {
    await searchCommand(resolve(opts.path), query, opts.scope);
  });

program
  .command('add <content>')
  .description('Manually add a memory')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-c, --category <category>', 'Memory category', 'convention')
  .option('-f, --files <files...>', 'Related file paths')
  .option('-t, --tier <tier>', 'Memory tier: personal (default) or team', 'personal')
  .action(async (content, opts) => {
    await addCommand(resolve(opts.path), content, opts.category, opts.files ?? [], opts.tier);
  });

program
  .command('forget <memoryId>')
  .description('Delete a memory')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (memoryId, opts) => {
    await forgetCommand(resolve(opts.path), memoryId);
  });

program
  .command('share <memoryId>')
  .description('Share a personal memory with the team')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (memoryId, opts) => {
    await shareCommand(resolve(opts.path), memoryId);
  });

program
  .command('team')
  .description('Show team memory status — authors, counts, sync state')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (opts) => {
    await teamCommand(resolve(opts.path));
  });

program
  .command('dashboard')
  .description('Open the TeamLens web dashboard')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('--port <port>', 'Dashboard port', '3847')
  .action(async (opts) => {
    await dashboardCommand(resolve(opts.path), opts.port ? parseInt(opts.port, 10) : undefined);
  });

program
  .command('feed')
  .description('Show the team insights feed')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-l, --limit <limit>', 'Number of insights to show', '20')
  .action(async (opts) => {
    await feedCommand(resolve(opts.path), opts.limit ? parseInt(opts.limit, 10) : 20);
  });

// ── Rule Management ──

const rule = program
  .command('rule')
  .description('Manage team AI rules');

rule
  .command('add <content>')
  .description('Add a new team rule')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-c, --category <category>', 'Rule category', 'convention')
  .option('-s, --scope <scope>', 'Comma-separated glob patterns (e.g., "src/**/*.ts,lib/**")')
  .option('--priority <priority>', 'Rule priority: critical, high, normal, low', 'normal')
  .option('--good <example>', 'Good code example')
  .option('--bad <example>', 'Bad code example')
  .action(async (content, opts) => {
    await ruleAddCommand(resolve(opts.path), content, {
      category: opts.category,
      scope: opts.scope,
      priority: opts.priority,
      good: opts.good,
      bad: opts.bad,
    });
  });

rule
  .command('list')
  .description('List all rules')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-c, --category <category>', 'Filter by category')
  .option('-a, --all', 'Include disabled rules', false)
  .action(async (opts) => {
    await ruleListCommand(resolve(opts.path), { category: opts.category, all: opts.all });
  });

rule
  .command('enable <id>')
  .description('Enable a disabled rule')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    await ruleEnableCommand(resolve(opts.path), id);
  });

rule
  .command('disable <id>')
  .description('Disable a rule without deleting it')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (id, opts) => {
    await ruleDisableCommand(resolve(opts.path), id);
  });

// ── Distribution ──

program
  .command('distribute')
  .description('Generate agent config files (CLAUDE.md, .cursor/rules/, AGENTS.md, copilot-instructions.md)')
  .option('-p, --path <path>', 'Repository path', '.')
  .option('-t, --targets <targets...>', 'Specific targets: claude, cursor, copilot, agents_md')
  .action(async (opts) => {
    await distributeCommand(resolve(opts.path), opts.targets);
  });

program.parse();
