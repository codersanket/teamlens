import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function hotFilesRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/hot-files', (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const hotFiles = tl.analytics.getHotFiles(limit);
    return c.json({ hotFiles });
  });

  return route;
}
