import { TeamLens } from '@teamlens/core';

export async function teamCommand(repoPath: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const stats = tl.stats();
    const authors = tl.getTeamAuthors();
    const sharedCount = tl.team.sharedCount();

    console.log('Team Memory Status\n');
    console.log(`  Team memories:     ${stats.team}`);
    console.log(`  Personal memories: ${stats.personal}`);
    console.log(`  Shared file:       ${sharedCount} entries in team.jsonl`);
    console.log(`  Your author name:  ${tl.config.author}`);

    if (authors.length > 0) {
      console.log('\n  Contributors:');
      for (const a of authors) {
        const marker = a.author === tl.config.author ? ' (you)' : '';
        console.log(`    ${a.author}: ${a.count} memories${marker}`);
      }
    } else {
      console.log('\n  No team memories yet. Use `teamlens add -t team` or share a personal memory.');
    }

    // Sync check
    const imported = tl.syncTeam();
    if (imported > 0) {
      console.log(`\n  Synced ${imported} new team memories from team.jsonl.`);
    }
  } finally {
    tl.close();
  }
}
