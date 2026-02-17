import type { MemoryDatabase } from '../store/database.js';
import type {
  TeamAnalytics,
  DeveloperStats,
  ContributorEntry,
  UsageTrend,
  ROIMetrics,
  HotFile,
} from '../types.js';

/** Minutes saved per insight reused — each reuse saves ~15 minutes of re-discovery time. */
const MINUTES_PER_REUSE = 15;

export class AnalyticsEngine {
  constructor(private db: MemoryDatabase) {}

  /** Full analytics report for the dashboard. */
  getTeamAnalytics(days = 30): TeamAnalytics {
    const totalSessions = this.db.getTotalSessionCount();
    const stats = this.db.getMemoryCount();
    const developers = this.db.getDistinctDevelopers();

    const avgInsightsPerSession = totalSessions > 0 ? stats.team / totalSessions : 0;

    return {
      overview: {
        totalSessions,
        totalInsights: stats.team,
        activeDevelopers: developers.length,
        avgInsightsPerSession: Math.round(avgInsightsPerSession * 100) / 100,
      },
      roi: this.getRoiMetrics(),
      trends: this.getUsageTrends(days),
      contributors: this.getContributorLeaderboard(),
      hotFiles: this.getHotFiles(),
      insightsByType: this.getInsightsByType(),
    };
  }

  /** Dashboard overview stats with time ranges. */
  getOverview(): {
    today: { sessions: number; insights: number };
    week: { sessions: number; insights: number };
    month: { sessions: number; insights: number };
    total: { sessions: number; insights: number; developers: number };
    topContributors: { developer: string; count: number }[];
  } {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const farFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
      today: {
        sessions: this.db.getSessionsInRange(todayStart, farFuture).length,
        insights: this.db.getTeamInsightCountSince(todayStart),
      },
      week: {
        sessions: this.db.getSessionsInRange(weekStart, farFuture).length,
        insights: this.db.getTeamInsightCountSince(weekStart),
      },
      month: {
        sessions: this.db.getSessionsInRange(monthStart, farFuture).length,
        insights: this.db.getTeamInsightCountSince(monthStart),
      },
      total: {
        sessions: this.db.getTotalSessionCount(),
        insights: this.db.getTeamInsightCount(),
        developers: this.db.getDistinctDevelopers().length,
      },
      topContributors: this.db.getInsightCountsByDeveloper().slice(0, 3),
    };
  }

  /** Per-developer statistics. */
  getDeveloperStats(developer: string): DeveloperStats {
    const sessions = this.db.getSessionsByDeveloper(developer);
    const insights = this.db.getMemoriesByAuthor(developer).filter(m => m.tier === 'team');

    const totalDuration = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
    const avgDuration = sessions.length > 0 ? totalDuration / sessions.length : 0;

    const reuseCount = insights.reduce((sum, m) => sum + m.reuseCount, 0);

    const lastSession = sessions[0];

    return {
      developer,
      totalSessions: sessions.length,
      totalInsights: insights.length,
      avgSessionDuration: Math.round(avgDuration),
      insightsPerSession: sessions.length > 0
        ? Math.round((insights.length / sessions.length) * 100) / 100
        : 0,
      knowledgeReused: reuseCount,
      lastActive: lastSession?.startedAt ?? null,
    };
  }

  /** Contributor leaderboard ranked by impact score. */
  getContributorLeaderboard(limit = 20): ContributorEntry[] {
    const insightsByDeveloper = this.db.getInsightCountsByDeveloper();
    const allTeamMemories = this.db.getMemoriesByTier('team', false);

    // Calculate reuse counts per developer
    const reuseByDeveloper = new Map<string, number>();
    for (const memory of allTeamMemories) {
      if (memory.reuseCount > 0) {
        const current = reuseByDeveloper.get(memory.author) ?? 0;
        reuseByDeveloper.set(memory.author, current + memory.reuseCount);
      }
    }

    const entries: ContributorEntry[] = insightsByDeveloper.map((entry, index) => {
      const reused = reuseByDeveloper.get(entry.developer) ?? 0;
      return {
        rank: index + 1,
        developer: entry.developer,
        insightsShared: entry.count,
        knowledgeReused: reused,
        impactScore: entry.count * 2 + reused * 3,
      };
    });

    // Re-sort by impact score
    entries.sort((a, b) => b.impactScore - a.impactScore);

    // Re-rank after sorting
    entries.forEach((e, i) => { e.rank = i + 1; });

    return entries.slice(0, limit);
  }

  /** Daily usage trends over the given time range. */
  getUsageTrends(days = 30): UsageTrend[] {
    const sessionsByDate = this.db.getSessionCountsByDate(days);
    const insightsByDate = this.db.getInsightCountsByDate(days);
    const devsByDate = this.db.getActiveDevelopersByDate(days);

    // Merge into date-keyed map
    const dateMap = new Map<string, UsageTrend>();

    // Fill in all dates in the range
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      dateMap.set(dateStr, {
        date: dateStr,
        sessions: 0,
        insights: 0,
        activeDevelopers: 0,
      });
    }

    for (const entry of sessionsByDate) {
      const existing = dateMap.get(entry.date);
      if (existing) existing.sessions = entry.count;
    }

    for (const entry of insightsByDate) {
      const existing = dateMap.get(entry.date);
      if (existing) existing.insights = entry.count;
    }

    for (const entry of devsByDate) {
      const existing = dateMap.get(entry.date);
      if (existing) existing.activeDevelopers = entry.count;
    }

    return Array.from(dateMap.values());
  }

  /** ROI metrics for the team. */
  getRoiMetrics(): ROIMetrics {
    const knowledgeReuseCount = this.db.getTotalReuseCount();
    const estimatedHoursSaved = Math.round((knowledgeReuseCount * MINUTES_PER_REUSE / 60) * 10) / 10;
    const totalSessions = this.db.getTotalSessionCount();
    const totalInsights = this.db.getMemoryCount().team;

    const totalDurationHours = this.db.getTotalSessionDuration() / 3600;
    const insightsPerAIHour = totalDurationHours > 0
      ? Math.round((totalInsights / totalDurationHours) * 100) / 100
      : 0;

    const hotFiles = this.db.getHotFiles(999);
    const allFilesWithInsights = new Set(
      this.db.getMemoriesByTier('team', false).flatMap(m => m.relatedFiles)
    );
    const teamKnowledgeCoverage = allFilesWithInsights.size > 0
      ? Math.min(allFilesWithInsights.size / Math.max(hotFiles.length, allFilesWithInsights.size), 1.0)
      : 0;

    return {
      duplicatesPrevented: 0, // Not yet implemented
      knowledgeReuseCount,
      estimatedHoursSaved,
      insightsPerAIHour,
      teamKnowledgeCoverage: Math.round(teamKnowledgeCoverage * 100) / 100,
    };
  }

  /** Insight breakdown by category. */
  getInsightsByType(): Record<string, number> {
    return this.db.getInsightsByCategory();
  }

  /** Files with most insights. */
  getHotFiles(limit = 10): HotFile[] {
    const raw = this.db.getHotFiles(limit);
    return raw.map(r => ({
      filePath: r.filePath,
      insightCount: r.count,
      lastInsight: r.lastInsight,
    }));
  }
}
