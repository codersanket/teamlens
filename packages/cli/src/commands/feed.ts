import { TeamLens } from '@teamlens/core';

export async function feedCommand(repoPath: string, limit = 20): Promise<void> {
  const tl = await TeamLens.create(repoPath);

  try {
    const insights = tl.db.getRecentInsights(limit);

    if (insights.length === 0) {
      console.log('No team insights yet. Share insights during AI sessions to build the feed.\n');
      return;
    }

    console.log(`Team Insights Feed (${insights.length} most recent)\n`);

    for (const insight of insights) {
      const date = new Date(insight.createdAt);
      const timeAgo = getTimeAgo(date);
      const files = insight.relatedFiles.length > 0 ? ` | ${insight.relatedFiles.join(', ')}` : '';

      console.log(`  [${insight.category}] ${insight.content}`);
      console.log(`    by ${insight.author} · ${timeAgo}${files}`);
      if (insight.reuseCount > 0) {
        console.log(`    reused ${insight.reuseCount} time(s)`);
      }
      console.log('');
    }
  } finally {
    tl.close();
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
