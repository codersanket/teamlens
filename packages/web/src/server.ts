import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamLens } from '@teamlens/core';
import { overviewRoute } from './routes/overview.js';
import { sessionsRoute } from './routes/sessions.js';
import { insightsRoute } from './routes/insights.js';
import { contributorsRoute } from './routes/contributors.js';
import { analyticsRoute } from './routes/analytics.js';
import { hotFilesRoute } from './routes/hot-files.js';

export function createApp(tl: TeamLens): Hono {
  const app = new Hono();

  // Reload DB from disk before each API request so we see data
  // written by the MCP server (which runs in a separate process)
  app.use('/api/*', async (c, next) => {
    tl.db.reload();
    await next();
  });

  // API routes
  app.route('/api', overviewRoute(tl));
  app.route('/api', sessionsRoute(tl));
  app.route('/api', insightsRoute(tl));
  app.route('/api', contributorsRoute(tl));
  app.route('/api', analyticsRoute(tl));
  app.route('/api', hotFilesRoute(tl));

  // Static files - serve from public/ directory
  // Use manual static file serving since we can't use hono/node-server in ESM easily
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, '..', 'public');

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  app.get('*', async (c) => {
    const urlPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const filePath = path.join(publicDir, urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(publicDir)) {
      return c.text('Forbidden', 403);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      });
    }

    // SPA fallback — serve index.html for non-API routes
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath);
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return c.text('Not Found', 404);
  });

  return app;
}
