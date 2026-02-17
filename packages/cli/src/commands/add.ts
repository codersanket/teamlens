import { TeamLens } from '@teamlens/core';
import type { MemoryCategory, MemoryTier } from '@teamlens/core';

const VALID_CATEGORIES: MemoryCategory[] = [
  'architecture',
  'convention',
  'decision',
  'correction',
  'active_context',
  'discovery',
  'gotcha',
  'dependency',
];

export async function addCommand(
  repoPath: string,
  content: string,
  category: string,
  files: string[],
  tier: string = 'personal'
): Promise<void> {
  if (!VALID_CATEGORIES.includes(category as MemoryCategory)) {
    console.error(`Invalid category: ${category}`);
    console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  const memoryTier = tier === 'team' ? 'team' : 'personal';
  const tl = await TeamLens.create(repoPath);

  try {
    const id = await tl.remember(content, category as MemoryCategory, files, [], memoryTier as MemoryTier);
    console.log(`Memory stored: ${id}`);
    console.log(`  Category: ${category}`);
    console.log(`  Tier:     ${memoryTier}`);
    console.log(`  Content:  ${content}`);
    if (files.length > 0) {
      console.log(`  Files:    ${files.join(', ')}`);
    }
  } finally {
    tl.close();
  }
}
