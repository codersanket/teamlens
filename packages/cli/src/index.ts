#!/usr/bin/env node

import { Command } from 'commander';
import { resolve } from 'node:path';
import { initCommand } from './commands/init.js';
import { watchCommand } from './commands/watch.js';
import { statusCommand } from './commands/status.js';
import { searchCommand } from './commands/search.js';
import { addCommand } from './commands/add.js';
import { forgetCommand } from './commands/forget.js';

const program = new Command();

program
  .name('codememory')
  .description('Git-aware memory layer for AI coding agents')
  .version('0.1.0');

program
  .command('init')
  .description('Scan repo and build initial memory from git history')
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
    const { startMcpServer } = await import('@codememory/mcp-server');
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
  .action(async (content, opts) => {
    await addCommand(resolve(opts.path), content, opts.category, opts.files ?? []);
  });

program
  .command('forget <memoryId>')
  .description('Delete a memory')
  .option('-p, --path <path>', 'Repository path', '.')
  .action(async (memoryId, opts) => {
    await forgetCommand(resolve(opts.path), memoryId);
  });

program.parse();
