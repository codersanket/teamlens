import { TeamLens } from '@teamlens/core';

export async function shareCommand(repoPath: string, memoryId: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const result = tl.share(memoryId);

    if (result.success) {
      console.log(`Memory ${memoryId} shared with team.`);
      console.log('  It will be available to teammates after they git pull.');
    } else {
      console.error(`Failed: ${result.error}`);
      process.exitCode = 1;
    }
  } finally {
    tl.close();
  }
}
