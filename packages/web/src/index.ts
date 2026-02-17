import { createServer } from 'node:http';
import { TeamLens } from '@teamlens/core';
import { createApp } from './server.js';

export async function startDashboard(repoPath: string, port = 3847): Promise<void> {
  const tl = await TeamLens.create(repoPath);
  const app = createApp(tl);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const response = await app.fetch(new Request(url.toString(), {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v!])
        ),
      }));

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const body = await response.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (err) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  server.listen(port, () => {
    console.log(`  TeamLens Dashboard: http://localhost:${port}`);
  });

  process.on('SIGINT', () => { tl.close(); server.close(); process.exit(0); });
  process.on('SIGTERM', () => { tl.close(); server.close(); process.exit(0); });
}
