import { CodeMemory } from '@codememory/core';

export async function forgetCommand(repoPath: string, memoryId: string): Promise<void> {
  const cm = new CodeMemory(repoPath);

  try {
    const existing = cm.db.getMemory(memoryId);
    if (!existing) {
      console.error(`Memory not found: ${memoryId}`);
      process.exit(1);
    }

    cm.forget(memoryId);
    console.log(`Deleted memory: ${memoryId}`);
    console.log(`  Was: ${existing.content}`);
  } finally {
    cm.close();
  }
}
