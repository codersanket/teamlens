import { CodeMemory } from '@codememory/core';

export async function initCommand(repoPath: string): Promise<void> {
  console.log('Initializing CodeMemory...\n');

  const cm = new CodeMemory(repoPath);

  try {
    const { memoriesCreated, filesTracked } = await cm.init();

    console.log(`  Files tracked:    ${filesTracked}`);
    console.log(`  Memories created: ${memoriesCreated}`);
    console.log(`  Storage:          ${repoPath}/.codememory/`);

    const embeddingsAvailable = await cm.embeddings.isAvailable();
    if (embeddingsAvailable) {
      console.log('  Embeddings:       enabled (Ollama)');
    } else {
      console.log('  Embeddings:       disabled (install Ollama + nomic-embed-text for semantic search)');
    }

    console.log('\nCodeMemory initialized. Run `codememory watch` to start the daemon.');
  } finally {
    cm.close();
  }
}
