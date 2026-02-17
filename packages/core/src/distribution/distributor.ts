import fs from 'node:fs';
import path from 'node:path';
import type { Memory, DistributionTarget, RulePriority } from '../types.js';
import type { MemoryDatabase } from '../store/database.js';

const SECTION_START = '<!-- TEAMLENS:START -->';
const SECTION_END = '<!-- TEAMLENS:END -->';

const PRIORITY_ORDER: RulePriority[] = ['critical', 'high', 'normal', 'low'];

function priorityLabel(p: RulePriority | null): string {
  return p ?? 'normal';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = map.get(k) ?? [];
    group.push(item);
    map.set(k, group);
  }
  return map;
}

export class Distributor {
  constructor(
    private db: MemoryDatabase,
    private repoPath: string
  ) {}

  /** Auto-detect which targets are available. Always includes claude + agents_md. */
  detectTargets(): DistributionTarget[] {
    const targets: DistributionTarget[] = ['claude', 'agents_md'];

    if (fs.existsSync(path.join(this.repoPath, '.cursor'))) {
      targets.push('cursor');
    }
    if (fs.existsSync(path.join(this.repoPath, '.github'))) {
      targets.push('copilot');
    }

    return targets;
  }

  /** Generate config files for the given targets (auto-detect if not specified). */
  distribute(targets?: DistributionTarget[]): { generated: string[]; warnings: string[] } {
    const activeTargets = targets ?? this.detectTargets();
    const rules = this.db.getRules(false);
    const recentInsights = this.db.getRecentInsights(10);
    const generated: string[] = [];
    const warnings: string[] = [];

    for (const target of activeTargets) {
      switch (target) {
        case 'claude':
          this.generateClaudeMd(rules, recentInsights, warnings);
          generated.push('CLAUDE.md');
          break;
        case 'cursor':
          this.generateCursorRules(rules);
          generated.push('.cursor/rules/');
          break;
        case 'agents_md':
          this.generateAgentsMd(rules);
          generated.push('AGENTS.md');
          break;
        case 'copilot':
          this.generateCopilotInstructions(rules);
          generated.push('.github/copilot-instructions.md');
          break;
      }
    }

    return { generated, warnings };
  }

  // ── CLAUDE.md ──

  /**
   * Build the TeamLens section content (used by CLAUDE.md, AGENTS.md, etc.)
   */
  private buildTeamLensSection(rules: Memory[], recentInsights: Memory[]): string {
    let content = '';

    // Session protocol instructions
    content += '## TeamLens — REQUIRED Protocol\n\n';
    content += 'This project uses TeamLens for team AI intelligence. You MUST follow this protocol:\n\n';
    content += '### Sharing Insights (MANDATORY)\n\n';
    content += 'After completing any significant task, you MUST call `share_insight` to share what you learned.\n';
    content += 'Examples of when to share:\n';
    content += '- You discovered a bug or gotcha ("The auth middleware silently swallows 401 errors")\n';
    content += '- You figured out how something works ("Payment webhooks retry 3x with exponential backoff")\n';
    content += '- You made an architecture decision ("Used JSONL instead of JSON for append-friendly sync")\n';
    content += '- You found a convention ("All API routes return { data, error } shape")\n';
    content += '- You fixed a tricky issue ("ESM imports need .js extension even for .ts files")\n\n';
    content += '**Call `share_insight` at least once per task.** If you learned nothing worth sharing, that is rare.\n\n';
    content += '### Querying Team Knowledge\n\n';
    content += 'Before starting work, call `ask` to check if teammates already solved a similar problem.\n';
    content += 'This prevents duplicate work and surfaces existing conventions.\n\n';
    content += '### Sessions\n\n';
    content += 'Sessions are tracked automatically — no need to start/end manually.\n\n';

    // Recent team insights
    if (recentInsights.length > 0) {
      content += '## Recent Team Insights\n\n';
      for (const insight of recentInsights.slice(0, 5)) {
        content += `- **[${insight.category}]** ${insight.content}`;
        if (insight.author !== 'unknown') {
          content += ` _(${insight.author})_`;
        }
        content += '\n';
      }
      content += '\n';
    }

    // Rules grouped by priority, then by category
    if (rules.length > 0) {
      for (const priority of PRIORITY_ORDER) {
        const priorityRules = rules.filter((r) => priorityLabel(r.priority) === priority);
        if (priorityRules.length === 0) continue;

        content += `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Rules\n\n`;

        const byCategory = groupBy(priorityRules, (r) => r.category);
        for (const [category, categoryRules] of byCategory) {
          content += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

          for (const rule of categoryRules) {
            content += `- ${rule.content}`;
            if (rule.scope && rule.scope.length > 0) {
              content += ` _(applies to: ${rule.scope.join(', ')})_`;
            }
            content += '\n';

            if (rule.examples) {
              if (rule.examples.good) {
                content += `  - Good: \`${rule.examples.good}\`\n`;
              }
              if (rule.examples.bad) {
                content += `  - Bad: \`${rule.examples.bad}\`\n`;
              }
            }
          }
          content += '\n';
        }
      }
    }

    return content;
  }

  /**
   * Merge a TeamLens section into an existing file.
   * - If the file has TEAMLENS markers, replace only that section.
   * - If the file exists but has no markers, append the section at the end.
   * - If the file doesn't exist, create it with just the section.
   */
  private mergeSection(filePath: string, sectionContent: string): void {
    const wrappedSection = `${SECTION_START}\n${sectionContent}${SECTION_END}\n`;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, wrappedSection);
      return;
    }

    const existing = fs.readFileSync(filePath, 'utf-8');

    // If file has our markers, replace only that section
    const startIdx = existing.indexOf(SECTION_START);
    const endIdx = existing.indexOf(SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + SECTION_END.length + 1); // +1 for trailing \n
      fs.writeFileSync(filePath, before + wrappedSection + after);
      return;
    }

    // If file was previously generated by TeamLens (old format), replace entirely
    if (existing.startsWith('# Generated by TeamLens') || existing.startsWith('# Generated by CodeMemory')) {
      fs.writeFileSync(filePath, wrappedSection);
      return;
    }

    // Otherwise append to the end with a blank line separator
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(filePath, existing + separator + wrappedSection);
  }

  private generateClaudeMd(rules: Memory[], recentInsights: Memory[], _warnings: string[]): void {
    const filePath = path.join(this.repoPath, 'CLAUDE.md');
    const section = this.buildTeamLensSection(rules, recentInsights);
    this.mergeSection(filePath, section);
  }

  // ── .cursor/rules/ ──

  private generateCursorRules(rules: Memory[]): void {
    const rulesDir = path.join(this.repoPath, '.cursor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    // Separate scoped vs global rules
    const globalRules = rules.filter((r) => !r.scope || r.scope.length === 0);
    const scopedRules = rules.filter((r) => r.scope && r.scope.length > 0);

    // Global rules → _global.mdc
    if (globalRules.length > 0) {
      let content = '---\n';
      content += 'description: Global project rules from TeamLens\n';
      content += 'alwaysApply: true\n';
      content += '---\n\n';
      content += '# Generated by TeamLens\n\n';

      for (const rule of globalRules) {
        content += `- ${rule.content}\n`;
        if (rule.examples) {
          if (rule.examples.good) content += `  - Good: \`${rule.examples.good}\`\n`;
          if (rule.examples.bad) content += `  - Bad: \`${rule.examples.bad}\`\n`;
        }
      }

      fs.writeFileSync(path.join(rulesDir, '_global.mdc'), content);
    }

    // Scoped rules → one .mdc per rule
    for (const rule of scopedRules) {
      const slug = rule.id.slice(0, 8);
      const globs = JSON.stringify(rule.scope);
      const summary = rule.content.slice(0, 60).replace(/[^a-zA-Z0-9 ]/g, '').trim();

      let content = '---\n';
      content += `description: ${summary}\n`;
      content += `globs: ${globs}\n`;
      content += 'alwaysApply: false\n';
      content += '---\n\n';
      content += rule.content + '\n';

      if (rule.examples) {
        content += '\n';
        if (rule.examples.good) content += `Good: \`${rule.examples.good}\`\n`;
        if (rule.examples.bad) content += `Bad: \`${rule.examples.bad}\`\n`;
      }

      fs.writeFileSync(path.join(rulesDir, `teamlens-${slug}.mdc`), content);
    }
  }

  // ── AGENTS.md ──

  private generateAgentsMd(rules: Memory[]): void {
    const filePath = path.join(this.repoPath, 'AGENTS.md');

    let content = '';
    const byCategory = groupBy(rules, (r) => r.category);

    for (const [category, categoryRules] of byCategory) {
      content += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

      for (const rule of categoryRules) {
        const priorityTag = rule.priority && rule.priority !== 'normal' ? ` [${rule.priority}]` : '';
        content += `- ${rule.content}${priorityTag}\n`;

        if (rule.scope && rule.scope.length > 0) {
          content += `  - Scope: ${rule.scope.join(', ')}\n`;
        }
        if (rule.examples) {
          if (rule.examples.good) content += `  - Good: \`${rule.examples.good}\`\n`;
          if (rule.examples.bad) content += `  - Bad: \`${rule.examples.bad}\`\n`;
        }
      }
      content += '\n';
    }

    this.mergeSection(filePath, content);
  }

  // ── .github/copilot-instructions.md ──

  private generateCopilotInstructions(rules: Memory[]): void {
    const dir = path.join(this.repoPath, '.github');
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, 'copilot-instructions.md');

    let content = '';
    for (const rule of rules) {
      content += `- ${rule.content}\n`;
    }

    this.mergeSection(filePath, content);
  }
}
