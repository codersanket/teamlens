import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Hook log command — called by Claude Code PostToolUse hooks.
 *
 * Reads tool use data from stdin, appends activity to .teamlens/hooks.jsonl.
 * Designed to be fast and lightweight — no sql.js, no async, just file append.
 * The MCP server ingests this file into the DB on each tool call.
 */
export async function hookLogCommand(repoPath: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim();
  if (!input) return;

  try {
    const data = JSON.parse(input);
    const toolName: string = data.tool_name ?? 'unknown';
    const toolInput: Record<string, unknown> = data.tool_input ?? {};

    // Skip tools that don't represent meaningful activity
    const skipTools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion', 'TaskList', 'TaskGet'];
    if (skipTools.includes(toolName)) return;

    // Extract files from tool input
    const files: string[] = [];
    if (typeof toolInput.file_path === 'string') {
      files.push(relativePath(repoPath, toolInput.file_path));
    }
    if (typeof toolInput.notebook_path === 'string') {
      files.push(relativePath(repoPath, toolInput.notebook_path));
    }

    // Map tool to activity type
    let type = 'other';
    if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') type = 'file_edit';
    else if (toolName === 'Bash') type = 'implementation';
    else if (toolName === 'Task' || toolName === 'TaskCreate' || toolName === 'TaskUpdate') type = 'implementation';

    // Build description
    let description = toolName;
    if (files.length > 0) {
      description = `${toolName}: ${files.join(', ')}`;
    } else if (typeof toolInput.command === 'string') {
      const cmd = (toolInput.command as string).substring(0, 120);
      description = `${toolName}: ${cmd}`;
    }

    const event = {
      type,
      tool: toolName,
      description,
      files,
      timestamp: new Date().toISOString(),
    };

    // Find .teamlens directory — check provided path, then try git root
    let teamlensDir = path.join(repoPath, '.teamlens');
    if (!fs.existsSync(teamlensDir)) {
      try {
        const gitRoot = execSync('git rev-parse --show-toplevel', {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 2000,
        }).trim();
        teamlensDir = path.join(gitRoot, '.teamlens');
      } catch {
        // Not a git repo — skip
      }
    }

    if (!fs.existsSync(teamlensDir)) return;

    const hooksFile = path.join(teamlensDir, 'hooks.jsonl');
    fs.appendFileSync(hooksFile, JSON.stringify(event) + '\n');
  } catch {
    // Silent failure — hooks should never break the agent
  }
}

function relativePath(base: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return path.relative(base, filePath);
  }
  return filePath;
}
