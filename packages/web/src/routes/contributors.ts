import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function contributorsRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/contributors', (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const contributors = tl.analytics.getContributorLeaderboard(limit);

    const enriched = contributors.map((entry: any) => {
      const sessions = tl.db.getSessionsByDeveloper(entry.developer);
      return {
        ...entry,
        sessionCount: sessions.length,
        lastActiveAt: sessions[0]?.startedAt || null,
      };
    });

    return c.json({ contributors: enriched });
  });

  return route;
}
