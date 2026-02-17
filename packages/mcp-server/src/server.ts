import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TeamLens } from '@teamlens/core';
import { createMemoryTools } from './tools/memory-tools.js';

/**
 * TeamLens MCP Server.
 *
 * Exposes session-aware tools over stdio transport so any MCP-compatible
 * agent (Claude Code, Cursor, etc.) can track sessions and share insights.
 *
 * Auto-starts with the AI agent, auto-creates sessions on first interaction.
 *
 * Usage:
 *   teamlens serve            # starts MCP server on stdio
 *   teamlens watch            # starts watcher + MCP server
 */
export async function startMcpServer(repoPath: string): Promise<void> {
  // Auto-detect: if .teamlens/ doesn't exist, this project hasn't been set up.
  // Create it silently so the MCP server always starts (prevents Claude Code errors).
  const tl = await TeamLens.create(repoPath);

  // Auto-pull from git and import teammates' insights
  const { pulled, imported } = tl.team.autoGitPullAndImport();
  if (pulled || imported > 0) {
    process.stderr.write(`TeamLens: git pull ${pulled ? 'ok' : 'skipped'}, imported ${imported} new insight(s)\n`);
  }

  // Cleanup stale sessions from previous runs
  tl.sessions.cleanupStaleSessions();

  const server = new McpServer({
    name: 'teamlens',
    version: '0.1.0',
  });

  // Register all tools
  const tools = createMemoryTools(tl);

  for (const tool of tools) {
    // Build zod schema from the JSON schema definition
    const zodShape: Record<string, z.ZodTypeAny> = {};
    const props = (tool.inputSchema as any).properties ?? {};
    const required = (tool.inputSchema as any).required ?? [];

    for (const [key, schema] of Object.entries(props) as [string, any][]) {
      let field: z.ZodTypeAny;

      if (schema.type === 'string') {
        field = schema.enum ? z.enum(schema.enum) : z.string();
      } else if (schema.type === 'number') {
        field = z.number();
      } else if (schema.type === 'boolean') {
        field = z.boolean();
      } else if (schema.type === 'array') {
        field = z.array(z.string());
      } else {
        field = z.any();
      }

      if (!required.includes(key)) {
        field = field.optional();
      }

      zodShape[key] = field.describe(schema.description ?? '');
    }

    server.tool(
      tool.name,
      tool.description,
      zodShape,
      async (args) => {
        try {
          // Ingest hook events before each tool call
          try { tl.sessions.ingestHookEvents(repoPath); } catch { /* non-fatal */ }

          const result = await tool.handler(args as Record<string, unknown>);

          // Inject insight nudge if the AI has done significant work without sharing
          const nudge = tl.sessions.getInsightNudge();
          const contents: { type: 'text'; text: string }[] = [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ];
          if (nudge && tool.name !== 'share_insight') {
            contents.push({ type: 'text' as const, text: `\n⚡ ${nudge}` });
          }

          return { content: contents };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  // Register MCP Resources
  server.resource(
    'teamlens://context',
    'teamlens://context',
    async () => {
      const context = tl.sessions.getTeamContext(10);
      return {
        contents: [{
          uri: 'teamlens://context',
          text: JSON.stringify(context.map(m => ({
            content: m.content,
            category: m.category,
            author: m.author,
            createdAt: m.createdAt,
          })), null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  server.resource(
    'teamlens://feed',
    'teamlens://feed',
    async () => {
      const insights = tl.db.getRecentInsights(20);
      return {
        contents: [{
          uri: 'teamlens://feed',
          text: JSON.stringify(insights.map(m => ({
            content: m.content,
            category: m.category,
            author: m.author,
            relatedFiles: m.relatedFiles,
            createdAt: m.createdAt,
          })), null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Auto-create a session immediately so the dashboard shows activity
  // even if the AI doesn't explicitly call any TeamLens tools
  try {
    const session = tl.sessions.getOrCreateSession('auto');
    process.stderr.write(`TeamLens: session ${session.id.slice(0, 8)}... started\n`);
  } catch {
    // Non-fatal — session will be created on first tool call
  }

  // Auto-end session with summary on disconnect
  const gracefulShutdown = async () => {
    const session = tl.sessions.getActiveSession();
    if (session) {
      // Ingest any remaining hook events before generating summary
      try { tl.sessions.ingestHookEvents(repoPath); } catch { /* non-fatal */ }
      await tl.sessions.autoEndSessionWithSummary(session.id);
    }
    tl.close();
    process.exit(0);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}
