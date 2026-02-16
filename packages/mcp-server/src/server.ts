import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CodeMemory } from '@codememory/core';
import { createMemoryTools } from './tools/memory-tools.js';

/**
 * CodeMemory MCP Server.
 *
 * Exposes memory tools over stdio transport so any MCP-compatible
 * agent (Claude Code, Cursor, etc.) can query and write memories.
 *
 * Usage:
 *   codememory serve            # starts MCP server on stdio
 *   codememory watch            # starts watcher + MCP server
 */
export async function startMcpServer(repoPath: string): Promise<void> {
  const cm = new CodeMemory(repoPath);

  const server = new McpServer({
    name: 'codememory',
    version: '0.1.0',
  });

  // Register all memory tools
  const tools = createMemoryTools(cm);

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
          const result = await tool.handler(args as Record<string, unknown>);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
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

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', () => {
    cm.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cm.close();
    process.exit(0);
  });
}
