/* ============================================================
   TeamLens Dashboard — Vanilla JS SPA
   ============================================================ */

(function () {
  'use strict';

  // --------------- Helpers ---------------

  /** Format large numbers with commas */
  function fmtNum(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString('en-US');
  }

  /** Format a number as compact (1.2k, 3.4M) */
  function fmtCompact(n) {
    if (n == null) return '0';
    const num = Number(n);
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return num.toString();
  }

  /** Format duration in seconds to human readable */
  function fmtDuration(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** Relative time formatting (e.g. "2 hours ago") */
  function timeAgo(dateStr) {
    if (!dateStr) return 'unknown';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    const diffWeek = Math.floor(diffDay / 7);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
    if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
    if (diffWeek < 5) return `${diffWeek} week${diffWeek !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Get a CSS class for a category badge */
  function badgeClass(category) {
    const map = {
      architecture: 'badge-decision',
      convention: 'badge-pattern',
      decision: 'badge-decision',
      correction: 'badge-issue',
      active_context: 'badge-context',
      discovery: 'badge-setup',
      gotcha: 'badge-issue',
      dependency: 'badge-preference',
      pattern: 'badge-pattern',
      preference: 'badge-preference',
      issue: 'badge-issue',
      context: 'badge-context',
      setup: 'badge-setup',
      active: 'badge-active',
      completed: 'badge-completed',
      stale: 'badge-stale',
      abandoned: 'badge-stale',
    };
    return map[(category || '').toLowerCase()] || 'badge-default';
  }

  /** Escape HTML */
  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Shorten a file path for display */
  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    if (parts.length > 3) {
      return '.../' + parts.slice(-3).join('/');
    }
    return p;
  }

  // --------------- API ---------------

  async function api(path) {
    try {
      const res = await fetch('/api' + path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('API error:', path, err);
      return null;
    }
  }

  // --------------- State ---------------

  let currentPage = 'overview';
  let refreshTimer = null;
  let sessionDetailId = null;  // for session detail view
  let sessionsOffset = 0;
  const SESSIONS_LIMIT = 50;

  // --------------- DOM ---------------

  const contentEl = document.getElementById('content');
  const pageTitleEl = document.getElementById('page-title');
  const refreshBtn = document.getElementById('refresh-btn');
  const navItems = document.querySelectorAll('.nav-item');

  // --------------- Router ---------------

  const PAGE_TITLES = {
    overview: 'Overview',
    sessions: 'Sessions',
    insights: 'Insights',
    contributors: 'Contributors',
    analytics: 'Analytics',
  };

  function navigate(page) {
    currentPage = page;
    sessionDetailId = null;
    sessionsOffset = 0;
    pageTitleEl.textContent = PAGE_TITLES[page] || page;

    // Update nav active state
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    renderPage();
    resetRefreshTimer();
  }

  // Handle nav clicks
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(item.dataset.page);
    });
  });

  // Handle hash changes
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1) || 'overview';
    if (hash !== currentPage) navigate(hash);
  });

  // Refresh button
  refreshBtn.addEventListener('click', renderPage);

  // --------------- Auto Refresh ---------------

  function resetRefreshTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(renderPage, 30000);
  }

  // --------------- Render Dispatcher ---------------

  async function renderPage() {
    showLoading();
    switch (currentPage) {
      case 'overview':     await renderOverview(); break;
      case 'sessions':     await renderSessions(); break;
      case 'insights':     await renderInsights(); break;
      case 'contributors': await renderContributors(); break;
      case 'analytics':    await renderAnalytics(); break;
      default:             renderNotFound();
    }
  }

  function showLoading() {
    contentEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>`;
  }

  function showEmpty(title, message, html) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">--</div>
        <h3>${esc(title)}</h3>
        ${html ? `<div class="empty-state-body">${message}</div>` : `<p>${esc(message)}</p>`}
      </div>`;
  }

  function renderNotFound() {
    contentEl.innerHTML = showEmpty('Page not found', 'The page you requested does not exist.');
  }

  // --------------- Overview Page ---------------

  async function renderOverview() {
    const [overview, hotFiles] = await Promise.all([
      api('/overview'),
      api('/hot-files?limit=10'),
    ]);

    if (!overview || (!overview.totalSessions && !overview.totalInsights)) {
      contentEl.innerHTML = showEmpty('Welcome to TeamLens!', `
        <p>Get started in 3 steps:</p>
        <ol class="getting-started-steps">
          <li>Run <code>teamlens init --path .</code> to scan your repo</li>
          <li>Start coding with your AI agent — sessions track automatically</li>
          <li>Share insights with <code>share_insight</code> — your team gets smarter</li>
        </ol>`, true);
      return;
    }

    const roi = overview.roi || {};
    const hot = (hotFiles && hotFiles.hotFiles) || [];

    contentEl.innerHTML = `<div class="animate-in">
      <!-- ROI Banner -->
      <div class="roi-grid">
        <div class="roi-card">
          <div class="roi-label">Time Saved</div>
          <div class="roi-value">${fmtDuration(roi.timeSavedSeconds || 0)}</div>
          <div class="roi-sub">estimated via memory reuse</div>
        </div>
        <div class="roi-card">
          <div class="roi-label">Memory Reuses</div>
          <div class="roi-value">${fmtNum(roi.totalReuses || 0)}</div>
          <div class="roi-sub">times context was recalled</div>
        </div>
        <div class="roi-card">
          <div class="roi-label">Unique Insights</div>
          <div class="roi-value">${fmtNum(roi.uniqueInsights || overview.totalInsights || 0)}</div>
          <div class="roi-sub">captured from sessions</div>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Total Sessions</span>
          <span class="stat-value">${fmtNum(overview.totalSessions || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Active Sessions</span>
          <span class="stat-value accent">${fmtNum(overview.activeSessions || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Contributors</span>
          <span class="stat-value">${fmtNum(overview.totalContributors || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Activities</span>
          <span class="stat-value">${fmtNum(overview.totalActivities || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Avg Session Duration</span>
          <span class="stat-value">${fmtDuration(overview.avgSessionDuration || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Insights</span>
          <span class="stat-value green">${fmtNum(overview.totalInsights || 0)}</span>
        </div>
      </div>

      <!-- Hot Files -->
      ${hot.length > 0 ? `
      <div class="card">
        <div class="card-header">
          <h3>Hot Files</h3>
          <span class="section-subtitle">Most frequently touched files</span>
        </div>
        <div class="card-body">
          ${hot.map((f, i) => `
            <div class="hot-file-row">
              <span class="hot-file-rank">${i + 1}</span>
              <span class="hot-file-path" title="${esc(f.filePath || f.file || '')}">${esc(shortPath(f.filePath || f.file || ''))}</span>
              <span class="hot-file-count">${fmtNum(f.insightCount || 0)} insights</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }

  // --------------- Sessions Page ---------------

  async function renderSessions() {
    if (sessionDetailId) {
      await renderSessionDetail(sessionDetailId);
      return;
    }

    const data = await api(`/sessions?limit=${SESSIONS_LIMIT}&offset=${sessionsOffset}`);
    if (!data || !data.sessions || data.sessions.length === 0) {
      contentEl.innerHTML = showEmpty('No sessions yet', 'Sessions appear automatically when team members code with AI agents. Start a session by running your AI coding tool in a tracked repo.');
      return;
    }

    const total = data.total || data.sessions.length;
    const sessions = data.sessions;

    contentEl.innerHTML = `<div class="animate-in">
      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Author</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Activities</th>
                <th>Insights</th>
              </tr>
            </thead>
            <tbody>
              ${sessions.map(s => `
                <tr>
                  <td><a class="table-link session-link" data-id="${esc(s.id)}">${esc(s.id?.slice(0, 8) || 'N/A')}...</a></td>
                  <td>${esc(s.developer || 'unknown')}</td>
                  <td><span class="badge ${badgeClass(s.status)}">${esc(s.status || 'unknown')}</span></td>
                  <td>${timeAgo(s.startedAt || s.createdAt)}</td>
                  <td>${fmtDuration(s.durationSeconds || s.duration || 0)}</td>
                  <td>${fmtNum(s.activityCount || 0)}</td>
                  <td>${fmtNum(s.insightCount || s.memoryCount || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${total > SESSIONS_LIMIT ? `
      <div class="pagination">
        <button class="btn btn-ghost" id="prev-page" ${sessionsOffset === 0 ? 'disabled' : ''}>Previous</button>
        <span class="pagination-info">${sessionsOffset + 1}--${Math.min(sessionsOffset + SESSIONS_LIMIT, total)} of ${fmtNum(total)}</span>
        <button class="btn btn-ghost" id="next-page" ${sessionsOffset + SESSIONS_LIMIT >= total ? 'disabled' : ''}>Next</button>
      </div>` : ''}
    </div>`;

    // Bind session links
    contentEl.querySelectorAll('.session-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        sessionDetailId = link.dataset.id;
        renderPage();
      });
    });

    // Pagination
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    if (prevBtn) prevBtn.addEventListener('click', () => { sessionsOffset = Math.max(0, sessionsOffset - SESSIONS_LIMIT); renderPage(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { sessionsOffset += SESSIONS_LIMIT; renderPage(); });
  }

  async function renderSessionDetail(id) {
    const data = await api(`/sessions/${id}`);
    if (!data || !data.session) {
      contentEl.innerHTML = showEmpty('Session not found', 'This session may have been deleted.');
      return;
    }

    const s = data.session;
    const activities = data.activities || [];
    const insights = data.insights || [];

    pageTitleEl.textContent = `Session ${id.slice(0, 8)}...`;

    contentEl.innerHTML = `<div class="animate-in">
      <div class="session-detail">
        <div class="session-detail-header">
          <div>
            <div class="session-detail-title">${esc(s.id)}</div>
            <div style="margin-top:4px;font-size:0.8rem;color:var(--text-tertiary)">
              ${esc(s.developer || 'unknown')} &middot; ${timeAgo(s.startedAt || s.createdAt)} &middot;
              <span class="badge ${badgeClass(s.status)}">${esc(s.status || 'unknown')}</span>
            </div>
          </div>
          <a class="back-link" id="back-to-sessions">&larr; Back to Sessions</a>
        </div>

        <div class="stats-grid" style="margin-bottom:0">
          <div class="stat-card">
            <span class="stat-label">Duration</span>
            <span class="stat-value">${fmtDuration(s.durationSeconds || s.duration || 0)}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Activities</span>
            <span class="stat-value">${fmtNum(activities.length)}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Insights</span>
            <span class="stat-value accent">${fmtNum(insights.length)}</span>
          </div>
        </div>
      </div>

      ${activities.length > 0 ? `
      <div class="card">
        <div class="card-header"><h3>Activities</h3></div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>File</th>
                <th>Time</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${activities.map(a => {
                const file = a.filePath || (a.files && a.files[0]) || '';
                return `
                <tr>
                  <td><span class="badge badge-default">${esc(a.type || a.activityType || '')}</span></td>
                  <td><span class="filepath" title="${esc(file)}">${esc(shortPath(file))}</span></td>
                  <td>${timeAgo(a.timestamp || a.createdAt)}</td>
                  <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.description || a.details || a.summary || '')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      ${insights.length > 0 ? `
      <div class="section-header"><h2 class="section-title">Session Insights</h2></div>
      ${insights.map(m => `
        <div class="insight-card">
          <div class="insight-header">
            <span class="badge ${badgeClass(m.category)}">${esc(m.category || 'general')}</span>
            <span class="insight-meta">${esc(m.author || '')} &middot; ${timeAgo(m.createdAt)}</span>
          </div>
          <div class="insight-content">${esc(m.content)}</div>
        </div>
      `).join('')}` : ''}
    </div>`;

    document.getElementById('back-to-sessions').addEventListener('click', (e) => {
      e.preventDefault();
      sessionDetailId = null;
      pageTitleEl.textContent = 'Sessions';
      renderPage();
    });
  }

  // --------------- Insights Page ---------------

  async function renderInsights() {
    const data = await api('/insights?limit=50');
    if (!data || !data.insights || data.insights.length === 0) {
      contentEl.innerHTML = showEmpty('No insights yet', `
        <p>Insights are shared automatically during AI coding sessions.</p>
        <p>Your AI agent will use <code>share_insight</code> when it discovers gotchas, conventions, or architecture patterns.</p>`, true);
      return;
    }

    const insights = data.insights;

    // Gather unique categories for filter
    const categories = [...new Set(insights.map(m => m.category).filter(Boolean))];

    contentEl.innerHTML = `<div class="animate-in">
      <div class="filters">
        <select class="filter-input" id="filter-type">
          <option value="">All categories</option>
          ${categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
        <input class="filter-input" type="text" id="filter-author" placeholder="Filter by author..." />
        <input class="filter-input" type="text" id="filter-file" placeholder="Filter by file..." />
      </div>

      <div id="insights-list">
        ${renderInsightsList(insights)}
      </div>
    </div>`;

    // Bind filters
    const typeSelect = document.getElementById('filter-type');
    const authorInput = document.getElementById('filter-author');
    const fileInput = document.getElementById('filter-file');

    async function applyFilters() {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (typeSelect.value) params.set('type', typeSelect.value);
      if (authorInput.value) params.set('author', authorInput.value);
      if (fileInput.value) params.set('file', fileInput.value);

      const filtered = await api(`/insights?${params.toString()}`);
      const list = document.getElementById('insights-list');
      if (filtered && filtered.insights) {
        list.innerHTML = renderInsightsList(filtered.insights);
      }
    }

    typeSelect.addEventListener('change', applyFilters);
    let debounceTimer;
    const debounce = (fn) => { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, 300); };
    authorInput.addEventListener('input', () => debounce(applyFilters));
    fileInput.addEventListener('input', () => debounce(applyFilters));
  }

  function renderInsightsList(insights) {
    if (!insights.length) {
      return showEmpty('No matching insights', 'Try adjusting your filters.');
    }

    return insights.map(m => `
      <div class="insight-card">
        <div class="insight-header">
          <span class="badge ${badgeClass(m.category)}">${esc(m.category || 'general')}</span>
          <span class="insight-meta">${esc(m.author || 'unknown')} &middot; ${timeAgo(m.createdAt)}</span>
          ${m.reuseCount ? `<span class="insight-meta" style="margin-left:auto">reused ${fmtNum(m.reuseCount)}x</span>` : ''}
        </div>
        <div class="insight-content">${esc(m.content)}</div>
        <div class="insight-footer">
          ${(m.relatedFiles || []).length > 0 ? `
            <div class="tags">
              ${m.relatedFiles.slice(0, 5).map(f => `<span class="tag" title="${esc(f)}">${esc(shortPath(f))}</span>`).join('')}
              ${m.relatedFiles.length > 5 ? `<span class="tag">+${m.relatedFiles.length - 5} more</span>` : ''}
            </div>` : ''}
          ${(m.tags || []).length > 0 ? `
            <div class="tags" style="margin-left:8px">
              ${m.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}
            </div>` : ''}
        </div>
      </div>
    `).join('');
  }

  // --------------- Contributors Page ---------------

  async function renderContributors() {
    const data = await api('/contributors?limit=20');
    if (!data || !data.contributors || data.contributors.length === 0) {
      contentEl.innerHTML = showEmpty('No contributors yet', `
        <p>Contributors appear when team members share insights during AI sessions.</p>
        <p>Invite a teammate: have them run <code>teamlens setup</code> in this repo.</p>`, true);
      return;
    }

    const contributors = data.contributors;

    contentEl.innerHTML = `<div class="animate-in">
      <div class="card">
        <div class="card-header">
          <h3>Contributor Leaderboard</h3>
          <span class="section-subtitle">${fmtNum(contributors.length)} contributors</span>
        </div>
        <div class="card-body">
          <div class="leaderboard">
            ${contributors.map((c, i) => {
              const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-default';
              return `
                <div class="leaderboard-item">
                  <div class="rank ${rankClass}">${i + 1}</div>
                  <div class="leaderboard-info">
                    <div class="leaderboard-name">${esc(c.developer || 'unknown')}</div>
                    <div class="leaderboard-meta">Last active ${timeAgo(c.lastActiveAt)}</div>
                  </div>
                  <div class="leaderboard-stats">
                    <div class="leaderboard-stat">
                      <div class="leaderboard-stat-value">${fmtNum(c.sessionCount || 0)}</div>
                      <div class="leaderboard-stat-label">Sessions</div>
                    </div>
                    <div class="leaderboard-stat">
                      <div class="leaderboard-stat-value">${fmtNum(c.insightsShared || 0)}</div>
                      <div class="leaderboard-stat-label">Insights</div>
                    </div>
                    <div class="leaderboard-stat">
                      <div class="leaderboard-stat-value">${fmtNum(c.knowledgeReused || 0)}</div>
                      <div class="leaderboard-stat-label">Reuses</div>
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Contribution bar chart -->
      ${contributors.length > 0 ? `
      <div class="card" style="margin-top:16px">
        <div class="card-header">
          <h3>Session Distribution</h3>
        </div>
        <div class="card-body">
          <div class="bar-chart">
            ${(() => {
              const maxSessions = Math.max(...contributors.map(c => c.sessionCount || 0), 1);
              const colors = ['green', 'blue', 'purple', 'orange', 'cyan'];
              return contributors.slice(0, 10).map((c, i) => {
                const count = c.sessionCount || 0;
                const pct = (count / maxSessions * 100).toFixed(1);
                return `
                  <div class="bar-row">
                    <span class="bar-label" title="${esc(c.developer || '')}">${esc(c.developer || 'unknown')}</span>
                    <div class="bar-track">
                      <div class="bar-fill ${colors[i % colors.length]}" style="width:${pct}%"></div>
                    </div>
                    <span class="bar-value">${fmtNum(count)}</span>
                  </div>`;
              }).join('');
            })()}
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }

  // --------------- Analytics Page ---------------

  async function renderAnalytics() {
    const [analytics, roi, trends] = await Promise.all([
      api('/analytics?days=30'),
      api('/roi'),
      api('/trends?days=30'),
    ]);

    contentEl.innerHTML = `<div class="animate-in">
      <!-- ROI Section -->
      ${roi ? `
      <div class="section-header"><h2 class="section-title">Return on Investment</h2></div>
      <div class="roi-grid">
        <div class="roi-card">
          <div class="roi-label">Estimated Time Saved</div>
          <div class="roi-value">${fmtDuration(roi.timeSavedSeconds || 0)}</div>
          <div class="roi-sub">from memory reuse across sessions</div>
        </div>
        <div class="roi-card">
          <div class="roi-label">Total Memory Reuses</div>
          <div class="roi-value">${fmtNum(roi.totalReuses || 0)}</div>
          <div class="roi-sub">context recalls preventing re-discovery</div>
        </div>
        <div class="roi-card">
          <div class="roi-label">Active Memories</div>
          <div class="roi-value">${fmtNum(roi.activeMemories || roi.uniqueInsights || 0)}</div>
          <div class="roi-sub">non-stale insights in the knowledge base</div>
        </div>
      </div>` : ''}

      <!-- Team Analytics -->
      ${analytics ? `
      <div class="section-header"><h2 class="section-title">Team Analytics (Last 30 Days)</h2></div>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Sessions</span>
          <span class="stat-value">${fmtNum(analytics.totalSessions || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Insights Created</span>
          <span class="stat-value accent">${fmtNum(analytics.insightsCreated || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Active Contributors</span>
          <span class="stat-value">${fmtNum(analytics.activeContributors || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Files Touched</span>
          <span class="stat-value">${fmtNum(analytics.filesTouched || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Avg Session Length</span>
          <span class="stat-value">${fmtDuration(analytics.avgSessionDuration || 0)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Memory Reuse Rate</span>
          <span class="stat-value green">${analytics.reuseRate != null ? (analytics.reuseRate * 100).toFixed(0) + '%' : 'N/A'}</span>
        </div>
      </div>` : `
      <div class="stats-grid">
        ${showEmpty('No analytics data', 'Analytics will populate as sessions are recorded.')}
      </div>`}

      <!-- Usage Trends -->
      ${trends && trends.trends && trends.trends.length > 0 ? `
      <div class="card" style="margin-top:8px">
        <div class="card-header">
          <h3>Daily Activity Trend</h3>
          <span class="section-subtitle">Last 30 days</span>
        </div>
        <div class="card-body">
          <div class="trend-row">
            ${(() => {
              const maxVal = Math.max(...trends.trends.map(t => t.count || t.sessions || t.value || 0), 1);
              return trends.trends.map(t => {
                const val = t.count || t.sessions || t.value || 0;
                const pct = (val / maxVal * 100).toFixed(1);
                return `<div class="trend-bar" style="height:${Math.max(pct, 3)}%" title="${esc(t.date || t.day || '')}: ${fmtNum(val)}"></div>`;
              }).join('');
            })()}
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;">
            <span style="font-size:0.7rem;color:var(--text-muted)">${esc(trends.trends[0]?.date || trends.trends[0]?.day || '')}</span>
            <span style="font-size:0.7rem;color:var(--text-muted)">${esc(trends.trends[trends.trends.length - 1]?.date || trends.trends[trends.trends.length - 1]?.day || '')}</span>
          </div>
        </div>
      </div>` : ''}

      <!-- Category Breakdown -->
      ${analytics && analytics.categoryBreakdown ? `
      <div class="card" style="margin-top:16px">
        <div class="card-header">
          <h3>Insight Categories</h3>
        </div>
        <div class="card-body">
          <div class="bar-chart">
            ${(() => {
              const entries = Object.entries(analytics.categoryBreakdown).sort((a, b) => b[1] - a[1]);
              const maxVal = Math.max(...entries.map(e => e[1]), 1);
              const colors = ['purple', 'blue', 'cyan', 'green', 'orange'];
              return entries.map(([cat, count], i) => `
                <div class="bar-row">
                  <span class="bar-label">${esc(cat)}</span>
                  <div class="bar-track">
                    <div class="bar-fill ${colors[i % colors.length]}" style="width:${(count / maxVal * 100).toFixed(1)}%"></div>
                  </div>
                  <span class="bar-value">${fmtNum(count)}</span>
                </div>
              `).join('');
            })()}
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }

  // --------------- Mobile Menu ---------------

  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    // Close sidebar when a nav item is clicked on mobile
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('open');
      });
    });
  }

  // --------------- Init ---------------

  // Start on the page indicated by hash, or default to overview
  const initialPage = location.hash.slice(1) || 'overview';
  navigate(initialPage);

})();
