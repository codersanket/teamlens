import { watch } from 'chokidar';
import { TeamLens } from '@teamlens/core';
import { startMcpServer } from '@teamlens/mcp-server';
import path from 'node:path';

export async function watchCommand(repoPath: string): Promise<void> {
  console.log('Starting TeamLens daemon...\n');

  const tl = await TeamLens.create(repoPath);

  // Process any commits that happened while daemon was off
  const { newMemories, stalenessUpdates, teamImported } = await tl.processNewCommits();
  if (newMemories > 0 || stalenessUpdates > 0 || teamImported > 0) {
    console.log(`  Catch-up: ${newMemories} new memories, ${stalenessUpdates} staleness updates, ${teamImported} team imported`);
  }

  // Watch for file changes in the repo
  const gitDir = path.join(repoPath, '.git');
  const watcher = watch(
    [
      path.join(gitDir, 'refs', 'heads'),  // branch updates (commits)
      path.join(gitDir, 'HEAD'),            // HEAD changes
    ],
    { ignoreInitial: true }
  );

  watcher.on('change', async () => {
    try {
      const result = await tl.processNewCommits();
      if (result.newMemories > 0 || result.stalenessUpdates > 0 || result.teamImported > 0) {
        console.log(
          `[${new Date().toLocaleTimeString()}] +${result.newMemories} memories, ${result.stalenessUpdates} staleness updates, ${result.teamImported} team imported`
        );
      }
    } catch (err) {
      console.error('Error processing commits:', err);
    }
  });

  const stats = tl.stats();
  console.log(`  Memories: ${stats.total} (${stats.fresh} fresh, ${stats.stale} stale)`);
  console.log('  Watching for git changes...');
  console.log('  MCP server starting on stdio...\n');

  // Start MCP server (blocks until shutdown)
  await startMcpServer(repoPath);

  // Cleanup
  await watcher.close();
  tl.close();
}
