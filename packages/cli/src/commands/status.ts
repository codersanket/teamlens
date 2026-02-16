import { CodeMemory } from '@codememory/core';

export async function statusCommand(repoPath: string): Promise<void> {
  const cm = new CodeMemory(repoPath);

  try {
    const stats = cm.stats();
    const conventions = await cm.getConventions();
    const decisions = await cm.getDecisions();
    const embeddingsAvailable = await cm.embeddings.isAvailable();

    console.log('CodeMemory Status\n');
    console.log(`  Total memories:  ${stats.total}`);
    console.log(`  Fresh:           ${stats.fresh}`);
    console.log(`  Stale:           ${stats.stale}`);
    console.log(`  Conventions:     ${conventions.length}`);
    console.log(`  Decisions:       ${decisions.length}`);
    console.log(`  Embeddings:      ${embeddingsAvailable ? 'enabled' : 'disabled'}`);
    console.log(`  Storage:         ${repoPath}/.codememory/`);
  } finally {
    cm.close();
  }
}
