import type { TeamLens } from '@teamlens/core';
import type { MemoryTier, RulePriority, DistributionTarget, ActivityType } from '@teamlens/core';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Sync team knowledge from git (non-fatal, non-blocking feel). */
function syncTeamKnowledge(tl: TeamLens): void {
  try {
    tl.team.autoGitPullAndImport();
  } catch { /* non-fatal — never block a tool call */ }
}

export function createMemoryTools(tl: TeamLens): ToolDefinition[] {
  return [
    // ── Session Tools ──
    {
      name: 'start_session',
      description:
        'Optional — begin a new session with task context. Sessions are auto-created on first tool interaction, so this is only needed if you want to set a specific task description.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'What you are working on (e.g., "fixing auth bug in login flow")',
          },
          tool_name: {
            type: 'string',
            description: 'Name of the AI tool (e.g., "claude-code", "cursor")',
          },
        },
      },
      handler: async (args) => {
        const session = tl.sessions.startSession(
          args.task as string | undefined,
          args.tool_name as string | undefined
        );

        // Get team context for injection
        const teamContext = tl.sessions.getTeamContext(5);

        return {
          sessionId: session.id,
          developer: session.developer,
          status: 'active',
          teamContext: teamContext.map(m => ({
            content: m.content,
            category: m.category,
            author: m.author,
          })),
        };
      },
    },

    {
      name: 'share_insight',
      description:
        'Share a learning or discovery with the team. Use this when you discover something important — gotchas, conventions, architecture patterns, dependency issues, or decisions. Type is auto-detected. Works without explicit start_session.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The insight to share (e.g., "The auth module silently swallows 401 errors — always check response.ok")',
          },
          related_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths this insight relates to',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for organization',
          },
        },
        required: ['content'],
      },
      handler: async (args) => {
        const result = await tl.sessions.shareInsight(
          args.content as string,
          (args.related_files as string[]) ?? [],
          (args.tags as string[]) ?? []
        );

        const response: Record<string, unknown> = {
          memoryId: result.memoryId,
          insightType: result.insightType,
          sessionId: result.sessionId,
          status: 'shared',
        };

        // If this is the first interaction (auto-session just created), inject team context
        if (tl.sessions.wasSessionJustCreated()) {
          const teamContext = tl.sessions.getTeamContext(5);
          if (teamContext.length > 0) {
            response.teamContext = teamContext.map(m => ({
              content: m.content,
              category: m.category,
              author: m.author,
            }));
            response.message = `Session auto-started. Here are ${teamContext.length} recent insights from your team:`;
          }
        }

        return response;
      },
    },

    {
      name: 'log_activity',
      description:
        'Record what you are doing during this session. Helps track activity patterns and feeds into analytics.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['debug', 'refactor', 'file_edit', 'review', 'test', 'research', 'implementation', 'other'],
            description: 'Type of activity',
          },
          description: {
            type: 'string',
            description: 'Brief description of the activity',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files involved in this activity',
          },
        },
        required: ['type'],
      },
      handler: async (args) => {
        const result = tl.sessions.logActivity(
          args.type as ActivityType,
          args.description as string | undefined,
          (args.files as string[]) ?? []
        );

        const response: Record<string, unknown> = {
          eventId: result.eventId,
          sessionId: result.sessionId,
          status: 'logged',
        };

        // If this is the first interaction (auto-session just created), inject team context
        if (tl.sessions.wasSessionJustCreated()) {
          const teamContext = tl.sessions.getTeamContext(5);
          if (teamContext.length > 0) {
            response.teamContext = teamContext.map(m => ({
              content: m.content,
              category: m.category,
              author: m.author,
            }));
            response.message = `Session auto-started. Here are ${teamContext.length} recent insights from your team:`;
          }
        }

        return response;
      },
    },

    {
      name: 'end_session',
      description:
        'End the current session with an optional summary. Sessions also auto-end when the agent disconnects.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was accomplished',
          },
        },
      },
      handler: async (args) => {
        const session = tl.sessions.endSession(undefined, args.summary as string | undefined);
        if (!session) return { error: 'No active session to end' };
        return {
          sessionId: session.id,
          duration: session.durationSeconds,
          insightsShared: session.insightCount,
          activitiesLogged: session.activityCount,
          status: 'completed',
        };
      },
    },

    // ── Query Tools ──
    {
      name: 'ask',
      description:
        'Query team knowledge — search insights, conventions, decisions, and learnings from all teammates. Replaces get_context and get_team_context.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What you want to know (e.g., "how does payment processing work?")',
          },
          scope: {
            type: 'string',
            description: 'Optional directory path to narrow results (e.g., "src/auth/")',
          },
          limit: {
            type: 'number',
            description: 'Max number of results (default: 10)',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        // Pull latest team knowledge before querying
        syncTeamKnowledge(tl);

        const results = await tl.query(
          args.query as string,
          args.scope as string | undefined,
          args.limit as number | undefined
        );

        // Track reuse of insights — only count when a DIFFERENT developer queries
        const currentDeveloper = tl.config.developer !== 'unknown' ? tl.config.developer : tl.config.author;
        for (const r of results) {
          if (r.memory.tier === 'team' && r.memory.author !== currentDeveloper) {
            tl.db.incrementReuseCount(r.memory.id);
          }
        }

        const response: Record<string, unknown>[] = results.map((r) => ({
          content: r.memory.content,
          category: r.memory.category,
          tier: r.memory.tier,
          author: r.memory.author,
          relatedFiles: r.memory.relatedFiles,
          score: Math.round(r.score * 100) / 100,
          fromTeammate: r.memory.author !== currentDeveloper,
        }));

        // If this is the first interaction (auto-session just created), inject team context
        if (tl.sessions.wasSessionJustCreated()) {
          const teamContext = tl.sessions.getTeamContext(5);
          if (teamContext.length > 0) {
            return {
              results: response,
              teamContext: teamContext.map(m => ({
                content: m.content,
                category: m.category,
                author: m.author,
              })),
              message: `Session auto-started. Here are ${teamContext.length} recent insights from your team:`,
            };
          }
        }

        return response;
      },
    },

    {
      name: 'analytics',
      description:
        'Get ROI metrics, usage trends, and contributor leaderboard. Great for understanding team AI effectiveness.',
      inputSchema: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of days to include in trends (default: 30)',
          },
        },
      },
      handler: async (args) => {
        const days = (args.days as number) ?? 30;
        return tl.analytics.getTeamAnalytics(days);
      },
    },

    {
      name: 'status',
      description:
        'Get current session state, memory stats, and a quick overview of team activity.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        // Pull latest team knowledge before reporting status
        syncTeamKnowledge(tl);

        const session = tl.sessions.getActiveSession();
        const stats = tl.stats();
        const overview = tl.analytics.getOverview();

        return {
          session: session ? {
            id: session.id,
            task: session.task,
            duration: session.durationSeconds,
            insights: session.insightCount,
            activities: session.activityCount,
          } : null,
          memories: stats,
          today: overview.today,
          week: overview.week,
        };
      },
    },

    // ── Knowledge Tools (kept from CodeMemory) ──
    {
      name: 'get_conventions',
      description:
        'Get all project conventions — naming rules, code patterns, style guidelines, and team agreements.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const conventions = await tl.getConventions();
        return conventions.map((m) => ({
          content: m.content,
          tags: m.tags,
          relatedFiles: m.relatedFiles,
        }));
      },
    },

    {
      name: 'who_knows',
      description:
        'Find which team members have context about a topic. Returns authors ranked by how many relevant memories they have.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The topic to find expertise about (e.g., "authentication", "payment processing")',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        return tl.whoKnows(args.query as string);
      },
    },

    // ── Governance Tools ──
    {
      name: 'get_rules',
      description:
        'Get active team AI rules, optionally filtered by file path (scope matching) and category.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Optional file path to get rules that apply to it (via scope glob matching)',
          },
          category: {
            type: 'string',
            enum: ['architecture', 'convention', 'decision', 'correction', 'active_context', 'discovery', 'gotcha', 'dependency'],
            description: 'Optional category filter',
          },
          include_inactive: {
            type: 'boolean',
            description: 'Include disabled rules (default: false)',
          },
        },
      },
      handler: async (args) => {
        let rules = args.file_path
          ? tl.db.getRulesForFile(args.file_path as string)
          : tl.db.getRules((args.include_inactive as boolean | undefined) ?? false);

        if (args.category) {
          rules = rules.filter((r) => r.category === args.category);
        }

        return rules.map((r) => ({
          id: r.id,
          content: r.content,
          category: r.category,
          priority: r.priority ?? 'normal',
          scope: r.scope,
          active: r.active,
          examples: r.examples,
        }));
      },
    },

    {
      name: 'add_rule',
      description:
        'Define a new team AI rule with category, scope, priority, and optional code examples. Rules are distributed to all agent config files.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The rule text (e.g., "Use camelCase for variable names")',
          },
          category: {
            type: 'string',
            enum: ['architecture', 'convention', 'decision', 'correction', 'active_context', 'discovery', 'gotcha', 'dependency'],
            description: 'Rule category',
          },
          scope: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns this rule applies to (e.g., ["src/**/*.ts"]). Omit for global rules.',
          },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'normal', 'low'],
            description: 'Rule priority (default: normal)',
          },
          good_example: {
            type: 'string',
            description: 'Example of correct code',
          },
          bad_example: {
            type: 'string',
            description: 'Example of incorrect code',
          },
        },
        required: ['content', 'category'],
      },
      handler: async (args) => {
        const id = await tl.addRule(args.content as string, args.category as any, {
          scope: args.scope as string[] | undefined,
          priority: (args.priority as RulePriority) ?? 'normal',
          good: args.good_example as string | undefined,
          bad: args.bad_example as string | undefined,
        });
        return { id, status: 'rule_added' };
      },
    },

    {
      name: 'distribute_rules',
      description:
        'Generate agent config files (CLAUDE.md, .cursor/rules/, AGENTS.md, copilot-instructions.md) from the current rules and recent insights.',
      inputSchema: {
        type: 'object',
        properties: {
          targets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific targets to generate (default: auto-detect). Options: claude, cursor, copilot, agents_md',
          },
        },
      },
      handler: async (args) => {
        const targets = args.targets as DistributionTarget[] | undefined;
        const { generated, warnings } = tl.distribute(targets);
        return { generated, warnings, status: 'distributed' };
      },
    },
  ];
}
