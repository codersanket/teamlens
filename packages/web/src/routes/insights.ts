import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function insightsRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/insights', (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const typeFilter = c.req.query('type');
    const authorFilter = c.req.query('author');
    const fileFilter = c.req.query('file');

    let insights = tl.db.getRecentInsights(limit);

    if (typeFilter) {
      insights = insights.filter(m => m.category === typeFilter);
    }
    if (authorFilter) {
      insights = insights.filter(m => m.author === authorFilter);
    }
    if (fileFilter) {
      insights = insights.filter(m => m.relatedFiles.some(f => f.includes(fileFilter)));
    }

    return c.json({
      insights: insights.map(m => ({
        id: m.id,
        content: m.content,
        category: m.category,
        author: m.author,
        relatedFiles: m.relatedFiles,
        tags: m.tags,
        reuseCount: m.reuseCount,
        createdAt: m.createdAt,
      })),
    });
  });

  return route;
}
