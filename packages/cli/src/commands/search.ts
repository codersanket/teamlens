import { TeamLens } from '@teamlens/core';

export async function searchCommand(repoPath: string, query: string, scope?: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const results = await tl.query(query, scope, 10);

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
    tl.close();
  }
}
