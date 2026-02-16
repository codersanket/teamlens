import { CodeMemory } from '@codememory/core';

export async function searchCommand(repoPath: string, query: string, scope?: string): Promise<void> {
  const cm = new CodeMemory(repoPath);

  try {
    const results = await cm.query(query, scope, 10);

    if (results.length === 0) {
      console.log('No memories found.\n');
      return;
    }

    console.log(`Found ${results.length} memories:\n`);

    for (const { memory, score, breakdown } of results) {
      const staleTag = memory.staleness >= 0.6 ? ' [STALE]' : '';
      console.log(`  [${memory.category}] ${memory.content}${staleTag}`);
      console.log(`    Score: ${score.toFixed(2)} | Files: ${memory.relatedFiles.join(', ') || 'none'}`);
      console.log(`    ID: ${memory.id}\n`);
    }
  } finally {
    cm.close();
  }
}
