import type { CodeMemory } from '@codememory/core';

/**
 * MCP tool definitions for CodeMemory.
 *
 * Each tool maps to a CodeMemory method. The MCP server registers these
 * tools so any compatible agent (Claude Code, Cursor, etc.) can call them.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createMemoryTools(cm: CodeMemory): ToolDefinition[] {
  return [
    // ── Retrieval Tools ──
    {
      name: 'get_context',
      description:
        'Retrieve relevant project memories for a given query. Returns ranked memories about architecture, conventions, decisions, and recent changes.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What you want to know about the project',
          },
          scope: {
            type: 'string',
            description: 'Optional directory path to narrow results (e.g., "src/auth/")',
          },
          limit: {
            type: 'number',
            description: 'Max number of memories to return (default: 10)',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const results = await cm.query(
          args.query as string,
          args.scope as string | undefined,
          args.limit as number | undefined
        );
        return results.map((r) => ({
          content: r.memory.content,
          category: r.memory.category,
          confidence: r.memory.confidence,
          staleness: r.memory.staleness,
          relatedFiles: r.memory.relatedFiles,
          score: Math.round(r.score * 100) / 100,
        }));
      },
    },

    {
      name: 'get_conventions',
      description:
        'Get all project conventions — naming rules, code patterns, style guidelines, and team agreements.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const conventions = await cm.getConventions();
        return conventions.map((m) => ({
          content: m.content,
          tags: m.tags,
          relatedFiles: m.relatedFiles,
        }));
      },
    },

    {
      name: 'get_decisions',
      description:
        'Get architectural decisions and their reasoning for a module or the whole project. Answers "why was this approach chosen?"',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            description: 'Optional directory/module path to filter decisions',
          },
        },
      },
      handler: async (args) => {
        const decisions = await cm.getDecisions(args.scope as string | undefined);
        return decisions.map((m) => ({
          content: m.content,
          tags: m.tags,
          relatedFiles: m.relatedFiles,
          date: m.createdAt,
        }));
      },
    },

    {
      name: 'get_recent_changes',
      description:
        'Get summary of recent project changes. Helps agent understand what happened since the last session.',
      inputSchema: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'How many days back to look (default: 7)',
          },
        },
      },
      handler: async (args) => {
        const days = (args.days as number) || 7;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const allMemories = cm.db.getAllMemories(false);
        const recent = allMemories.filter((m) => m.createdAt >= since);
        return {
          count: recent.length,
          memories: recent.map((m) => ({
            content: m.content,
            category: m.category,
            date: m.createdAt,
            relatedFiles: m.relatedFiles,
          })),
        };
      },
    },

    // ── Writing Tools ──
    {
      name: 'remember',
      description:
        'Store a new memory about this project. Use this when you learn something important — conventions, architecture patterns, user preferences, gotchas, or decisions.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The fact or knowledge to remember',
          },
          category: {
            type: 'string',
            enum: ['architecture', 'convention', 'decision', 'correction', 'active_context'],
            description: 'Category of this memory',
          },
          related_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths this memory relates to',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for organization',
          },
        },
        required: ['content', 'category'],
      },
      handler: async (args) => {
        const id = await cm.remember(
          args.content as string,
          args.category as any,
          (args.related_files as string[]) ?? [],
          (args.tags as string[]) ?? []
        );
        return { id, status: 'stored' };
      },
    },

    {
      name: 'correct_memory',
      description:
        'Update an existing memory with corrected information. The old version is replaced.',
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: 'ID of the memory to correct',
          },
          correction: {
            type: 'string',
            description: 'The corrected content',
          },
        },
        required: ['memory_id', 'correction'],
      },
      handler: async (args) => {
        const existing = cm.db.getMemory(args.memory_id as string);
        if (!existing) return { error: 'Memory not found' };

        // Delete old, create corrected version
        cm.forget(args.memory_id as string);
        const newId = await cm.remember(
          args.correction as string,
          existing.category,
          existing.relatedFiles,
          [...existing.tags, 'corrected']
        );
        return { old_id: args.memory_id, new_id: newId, status: 'corrected' };
      },
    },

    // ── Feedback Tools ──
    {
      name: 'mark_stale',
      description: 'Flag a memory as outdated. It will be downranked in future queries.',
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: 'ID of the memory to mark as stale',
          },
        },
        required: ['memory_id'],
      },
      handler: async (args) => {
        cm.markStale(args.memory_id as string);
        return { status: 'marked_stale' };
      },
    },

    {
      name: 'confirm_memory',
      description: 'Confirm a memory is still valid. Resets its staleness score.',
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: 'ID of the memory to confirm',
          },
        },
        required: ['memory_id'],
      },
      handler: async (args) => {
        cm.confirm(args.memory_id as string);
        return { status: 'confirmed' };
      },
    },

    // ── Status ──
    {
      name: 'memory_status',
      description: 'Get stats about the memory store — total memories, stale count, fresh count.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        return cm.stats();
      },
    },
  ];
}
