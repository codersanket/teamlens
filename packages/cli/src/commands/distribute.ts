import { TeamLens } from '@teamlens/core';
import type { DistributionTarget } from '@teamlens/core';

const VALID_TARGETS: DistributionTarget[] = ['claude', 'cursor', 'copilot', 'agents_md'];

export async function distributeCommand(
  repoPath: string,
  targets?: string[]
): Promise<void> {
  if (targets) {
    for (const t of targets) {
      if (!VALID_TARGETS.includes(t as DistributionTarget)) {
        console.error(`Invalid target: ${t}`);
        console.error(`Valid targets: ${VALID_TARGETS.join(', ')}`);
        process.exit(1);
      }
    }
  }

  const tl = await TeamLens.create(repoPath);

  try {
    const rules = tl.db.getRules(false);
    if (rules.length === 0) {
      console.log('No active rules found. Add rules with `teamlens rule add`.\n');
      return;
    }

    const { generated, warnings } = tl.distribute(targets as DistributionTarget[] | undefined);

    for (const warning of warnings) {
      console.log(`  Warning: ${warning}`);
    }

    console.log(`Distributed ${rules.length} rule(s) to:\n`);
    for (const file of generated) {
      console.log(`  ${file}`);
    }
    console.log('');
  } finally {
    tl.close();
  }
}
