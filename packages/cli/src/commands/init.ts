import { TeamLens } from '@teamlens/core';

export async function initCommand(repoPath: string): Promise<void> {
  console.log('Initializing TeamLens...\n');

  const tl = await TeamLens.create(repoPath);

  try {
    const { memoriesCreated, filesTracked, teamImported } = await tl.init();

    console.log(`  Files tracked:    ${filesTracked}`);
    console.log(`  Memories created: ${memoriesCreated}`);
    if (teamImported > 0) {
      console.log(`  Team imported:    ${teamImported} (from team.jsonl)`);
    }
    console.log(`  Author:           ${tl.config.author}`);
    console.log(`  Storage:          ${repoPath}/.teamlens/`);

    const embeddingsAvailable = await tl.embeddings.isAvailable();
    if (embeddingsAvailable) {
      console.log('  Embeddings:       enabled (Ollama)');
    } else {
      console.log('  Embeddings:       disabled (install Ollama + nomic-embed-text for semantic search)');
    }

    console.log('\nTeamLens initialized. Run `teamlens watch` to start the daemon.');
  } finally {
    tl.close();
  }
}
