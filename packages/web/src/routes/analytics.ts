import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function analyticsRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/analytics', (c) => {
    const days = Number(c.req.query('days') ?? '30');
    const analytics = tl.analytics.getTeamAnalytics(days);

    const totalSessions = tl.db.getTotalSessionCount();
    const totalDuration = tl.db.getTotalSessionDuration();
    const avgSessionDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0;

    const memoryCount = tl.db.getMemoryCount();
    const totalInsights = memoryCount.team;
    const roi = tl.analytics.getRoiMetrics();
    const reuseRate = totalInsights > 0 ? roi.knowledgeReuseCount / totalInsights : 0;

    return c.json({
      totalSessions: analytics.overview?.totalSessions ?? totalSessions,
      insightsCreated: analytics.overview?.totalInsights ?? totalInsights,
      activeContributors: analytics.overview?.activeDevelopers ?? tl.db.getDistinctDevelopers().length,
      avgInsightsPerSession: analytics.overview?.avgInsightsPerSession ?? 0,
      avgSessionDuration,
      categoryBreakdown: analytics.insightsByType ?? {},
      reuseRate,
      filesTouched: 0,
    });
  });

  route.get('/roi', (c) => {
    const roi = tl.analytics.getRoiMetrics();
    const memoryCount = tl.db.getMemoryCount();

    return c.json({
      ...roi,
      timeSavedSeconds: Math.round(roi.estimatedHoursSaved * 3600),
      totalReuses: roi.knowledgeReuseCount,
      activeMemories: memoryCount.team,
      uniqueInsights: memoryCount.team,
    });
  });

  route.get('/trends', (c) => {
    const days = Number(c.req.query('days') ?? '30');
    const trends = tl.analytics.getUsageTrends(days);
    return c.json({ trends });
  });

  return route;
}
