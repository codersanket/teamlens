import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function sessionsRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    const sessions = tl.db.getAllSessions(limit, offset);
    return c.json({ sessions, total: tl.db.getTotalSessionCount() });
  });

  route.get('/sessions/:id', (c) => {
    const id = c.req.param('id');
    const session = tl.db.getSession(id);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const activities = tl.db.getActivitiesBySession(id);
    const insights = tl.db.getMemoriesBySessionId(id);

    return c.json({ session, activities, insights: insights.map(m => ({
      id: m.id,
      content: m.content,
      category: m.category,
      author: m.author,
      createdAt: m.createdAt,
    })) });
  });

  return route;
}
