import { resolve } from 'node:path';

export async function dashboardCommand(repoPath: string, port?: number): Promise<void> {
  const { startDashboard } = await import('@teamlens/web');

  const dashboardPort = port ?? 3847;
  console.log('Starting TeamLens Dashboard...\n');

  await startDashboard(repoPath, dashboardPort);

  // Open browser
  const { exec } = await import('node:child_process');
  const url = `http://localhost:${dashboardPort}`;

  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open ${url}`);
  } else if (platform === 'linux') {
    exec(`xdg-open ${url}`);
  } else if (platform === 'win32') {
    exec(`start ${url}`);
  }
}
