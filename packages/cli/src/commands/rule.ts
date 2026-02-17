import { TeamLens } from '@teamlens/core';
import type { MemoryCategory, RulePriority } from '@teamlens/core';

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

const VALID_PRIORITIES: RulePriority[] = ['critical', 'high', 'normal', 'low'];

export async function ruleAddCommand(
  repoPath: string,
  content: string,
  options: { category: string; scope?: string; priority: string; good?: string; bad?: string }
): Promise<void> {
  if (!VALID_CATEGORIES.includes(options.category as MemoryCategory)) {
    console.error(`Invalid category: ${options.category}`);
    console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  if (!VALID_PRIORITIES.includes(options.priority as RulePriority)) {
    console.error(`Invalid priority: ${options.priority}`);
    console.error(`Valid priorities: ${VALID_PRIORITIES.join(', ')}`);
    process.exit(1);
  }

  const tl = await TeamLens.create(repoPath);

  try {
    const id = await tl.addRule(content, options.category as MemoryCategory, {
      scope: options.scope ? options.scope.split(',').map((s) => s.trim()) : undefined,
      priority: options.priority as RulePriority,
      good: options.good,
      bad: options.bad,
    });

    console.log(`Rule stored: ${id}`);
    console.log(`  Category: ${options.category}`);
    console.log(`  Priority: ${options.priority}`);
    console.log(`  Content:  ${content}`);
    if (options.scope) {
      console.log(`  Scope:    ${options.scope}`);
    }
    if (options.good) {
      console.log(`  Good:     ${options.good}`);
    }
    if (options.bad) {
      console.log(`  Bad:      ${options.bad}`);
    }
  } finally {
    tl.close();
  }
}

export async function ruleListCommand(
  repoPath: string,
  options: { category?: string; all: boolean }
): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const rules = tl.db.getRules(options.all);

    const filtered = options.category
      ? rules.filter((r) => r.category === options.category)
      : rules;

    if (filtered.length === 0) {
      console.log('No rules found.\n');
      return;
    }

    console.log(`Found ${filtered.length} rule(s):\n`);

    for (const rule of filtered) {
      const activeTag = rule.active ? '' : ' [DISABLED]';
      const priorityTag = rule.priority && rule.priority !== 'normal' ? ` [${rule.priority}]` : '';
      console.log(`  [${rule.category}]${priorityTag} ${rule.content}${activeTag}`);
      if (rule.scope && rule.scope.length > 0) {
        console.log(`    Scope: ${rule.scope.join(', ')}`);
      }
      if (rule.examples) {
        if (rule.examples.good) console.log(`    Good: ${rule.examples.good}`);
        if (rule.examples.bad) console.log(`    Bad:  ${rule.examples.bad}`);
      }
      console.log(`    ID: ${rule.id}\n`);
    }
  } finally {
    tl.close();
  }
}

export async function ruleEnableCommand(repoPath: string, id: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const memory = tl.db.getMemory(id);
    if (!memory) {
      console.error(`Rule not found: ${id}`);
      process.exit(1);
    }
    tl.db.setRuleActive(id, true);
    console.log(`Rule enabled: ${id}`);
  } finally {
    tl.close();
  }
}

export async function ruleDisableCommand(repoPath: string, id: string): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const memory = tl.db.getMemory(id);
    if (!memory) {
      console.error(`Rule not found: ${id}`);
      process.exit(1);
    }
    tl.db.setRuleActive(id, false);
    console.log(`Rule disabled: ${id}`);
  } finally {
    tl.close();
  }
}
