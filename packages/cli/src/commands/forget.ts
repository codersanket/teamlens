import { TeamLens } from '@teamlens/core';

export async function forgetCommand(repoPath: string, memoryId: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const existing = tl.db.getMemory(memoryId);
    if (!existing) {
      console.error(`Memory not found: ${memoryId}`);
      process.exit(1);
    }

    tl.forget(memoryId);
    console.log(`Deleted memory: ${memoryId}`);
    console.log(`  Was: ${existing.content}`);
  } finally {
    tl.close();
  }
}
