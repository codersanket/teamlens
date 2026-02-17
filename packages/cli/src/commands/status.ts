import { TeamLens } from '@teamlens/core';

export async function statusCommand(repoPath: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const stats = tl.stats();
    const conventions = await tl.getConventions();
    const decisions = await tl.getDecisions();
    const embeddingsAvailable = await tl.embeddings.isAvailable();

    const authors = tl.getTeamAuthors();

    console.log('TeamLens Status\n');
    console.log(`  Total memories:  ${stats.total}`);
    console.log(`  Personal:        ${stats.personal}`);
    console.log(`  Team:            ${stats.team}`);
    console.log(`  Fresh:           ${stats.fresh}`);
    console.log(`  Stale:           ${stats.stale}`);
    console.log(`  Conventions:     ${conventions.length}`);
    console.log(`  Decisions:       ${decisions.length}`);
    console.log(`  Embeddings:      ${embeddingsAvailable ? 'enabled' : 'disabled'}`);
    console.log(`  Author:          ${tl.config.author}`);
    console.log(`  Storage:         ${repoPath}/.teamlens/`);

    if (authors.length > 0) {
      console.log('\n  Team Authors:');
      for (const a of authors) {
        console.log(`    ${a.author}: ${a.count} memories`);
      }
    }
  } finally {
    tl.close();
  }
}
