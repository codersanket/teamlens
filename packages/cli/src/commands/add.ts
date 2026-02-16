import { CodeMemory } from '@codememory/core';
import type { MemoryCategory } from '@codememory/core';

const VALID_CATEGORIES: MemoryCategory[] = [
  'architecture',
  'convention',
  'decision',
  'correction',
  'active_context',
];

export async function addCommand(
  repoPath: string,
  content: string,
  category: string,
  files: string[]
): Promise<void> {
  if (!VALID_CATEGORIES.includes(category as MemoryCategory)) {
    console.error(`Invalid category: ${category}`);
    console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  const cm = new CodeMemory(repoPath);

  try {
    const id = await cm.remember(content, category as MemoryCategory, files);
    console.log(`Memory stored: ${id}`);
    console.log(`  Category: ${category}`);
    console.log(`  Content:  ${content}`);
    if (files.length > 0) {
      console.log(`  Files:    ${files.join(', ')}`);
    }
  } finally {
    cm.close();
  }
}
