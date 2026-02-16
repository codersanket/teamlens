import { watch } from 'chokidar';
import { CodeMemory } from '@codememory/core';
import { startMcpServer } from '@codememory/mcp-server';
import path from 'node:path';

export async function watchCommand(repoPath: string): Promise<void> {
  console.log('Starting CodeMemory daemon...\n');

  const cm = new CodeMemory(repoPath);

  // Process any commits that happened while daemon was off
  const { newMemories, stalenessUpdates } = await cm.processNewCommits();
  if (newMemories > 0 || stalenessUpdates > 0) {
    console.log(`  Catch-up: ${newMemories} new memories, ${stalenessUpdates} staleness updates`);
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
      const result = await cm.processNewCommits();
      if (result.newMemories > 0 || result.stalenessUpdates > 0) {
        console.log(
          `[${new Date().toLocaleTimeString()}] +${result.newMemories} memories, ${result.stalenessUpdates} staleness updates`
        );
      }
    } catch (err) {
      console.error('Error processing commits:', err);
    }
  });

  const stats = cm.stats();
  console.log(`  Memories: ${stats.total} (${stats.fresh} fresh, ${stats.stale} stale)`);
  console.log('  Watching for git changes...');
  console.log('  MCP server starting on stdio...\n');

  // Start MCP server (blocks until shutdown)
  await startMcpServer(repoPath);

  // Cleanup
  await watcher.close();
  cm.close();
}
