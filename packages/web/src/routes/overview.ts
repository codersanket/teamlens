import { Hono } from 'hono';
import type { TeamLens } from '@teamlens/core';

export function overviewRoute(tl: TeamLens): Hono {
  const route = new Hono();

  route.get('/overview', (c) => {
    const overview = tl.analytics.getOverview();
    const roi = tl.analytics.getRoiMetrics();
    const totalSessions = tl.db.getTotalSessionCount();
    const totalContributors = tl.db.getDistinctDevelopers().length;
    const memoryCount = tl.db.getMemoryCount();
    const totalInsights = memoryCount.team;

    // Count active sessions
    const allSessions = tl.db.getAllSessions(1000, 0);
    const activeSessions = allSessions.filter(s => s.status === 'active').length;

    // Average session duration (handle div by zero)
    const totalDuration = tl.db.getTotalSessionDuration();
    const avgSessionDuration = totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0;

    return c.json({
      totalSessions,
      activeSessions,
      totalContributors,
      totalActivities: 0,
      totalInsights,
      avgSessionDuration,
      today: overview.today,
      week: overview.week,
      month: overview.month,
      roi: {
        ...roi,
        timeSavedSeconds: Math.round(roi.estimatedHoursSaved * 3600),
        totalReuses: roi.knowledgeReuseCount,
        uniqueInsights: totalInsights,
      },
    });
  });

  return route;
}
