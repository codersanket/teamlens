import type { InsightType, MemoryCategory } from '../types.js';

const PATTERNS: Record<InsightType, RegExp[]> = {
  gotcha: [
    /\b(gotcha|pitfall|trap|caveat|watch out|careful|beware|silently|unexpect|quirk|subtle|hidden)\b/i,
    /\b(doesn'?t work|broke|breaking|fail|error when|crash|bug|issue with)\b/i,
    /\b(actually|turns out|it seems|surprisingly|counterintuitive)\b/i,
  ],
  convention: [
    /\b(convention|naming|style|pattern|always use|never use|prefer|standard|consistent)\b/i,
    /\b(format|lint|eslint|prettier|coding style|best practice)\b/i,
    /\b(should be|must be|required to|expected to)\b/i,
  ],
  architecture: [
    /\b(architect|structure|design|pattern|module|component|layer|service|system)\b/i,
    /\b(split|extract|decouple|separate|organize|restructure)\b/i,
    /\b(data flow|pipeline|middleware|handler|controller|provider)\b/i,
  ],
  dependency: [
    /\b(depend|package|library|version|npm|import|require|install|upgrade)\b/i,
    /\b(compatible|incompatible|peer|resolution|conflict)\b/i,
    /\b(deprecated|removed|replaced|alternative)\b/i,
  ],
  decision: [
    /\b(decided|chose|picked|selected|went with|opted for|reason)\b/i,
    /\b(because|instead of|trade-?off|pros? and cons?|alternative)\b/i,
    /\b(approach|strategy|solution|design decision)\b/i,
  ],
  correction: [
    /\b(wrong|incorrect|mistake|fix|correct|should not|don'?t|avoid|never)\b/i,
    /\b(deprecated|outdated|stale|obsolete|removed)\b/i,
    /\b(instead|replace|update|change to)\b/i,
  ],
  discovery: [
    /\b(found|discover|learn|realize|notice|understand|figure out)\b/i,
    /\b(how .+ works|works by|implemented as|under the hood)\b/i,
    /\b(interesting|notable|important|key insight)\b/i,
  ],
};

const INSIGHT_TO_CATEGORY: Record<InsightType, MemoryCategory> = {
  gotcha: 'gotcha',
  convention: 'convention',
  architecture: 'architecture',
  dependency: 'dependency',
  decision: 'decision',
  correction: 'correction',
  discovery: 'discovery',
};

export class InsightDetector {
  /** Detect the most likely insight type from content. */
  detect(content: string): InsightType {
    let bestType: InsightType = 'discovery';
    let bestScore = 0;

    for (const [type, patterns] of Object.entries(PATTERNS) as [InsightType, RegExp[]][]) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    return bestType;
  }

  /** Score confidence in the detected type (0.0 - 1.0). */
  scoreConfidence(content: string, type: InsightType): number {
    const patterns = PATTERNS[type];
    if (!patterns) return 0.5;

    let matches = 0;
    for (const pattern of patterns) {
      if (pattern.test(content)) matches++;
    }

    // Base confidence from pattern matches
    const matchRatio = matches / patterns.length;

    // Boost for longer content (more context = more confident)
    const lengthBoost = Math.min(content.length / 200, 0.2);

    return Math.min(0.5 + matchRatio * 0.4 + lengthBoost, 1.0);
  }

  /** Convert InsightType to MemoryCategory. */
  toCategory(type: InsightType): MemoryCategory {
    return INSIGHT_TO_CATEGORY[type];
  }
}
