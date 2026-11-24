import { api } from '../api.js';
import { fmtLatency, fmtLoss, fmtPct, fmtSpeed, timeAgo } from '../format.js';
import { emptyState, legend, segmented, statusBadge } from '../ui/components.js';
import { createTimeChart } from '../ui/charts.js';
import { h, replace } from '../ui/dom.js';

const RANGES = [
  { value: '6h', label: '6 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
];

const pctOf = (n, total) => (total ? Math.round((100 * n) / total) : 0);

function compositionBar(counts, total) {
  const seg = (key) => h('span', { class: `seg-${key}`, style: `width:${(100 * counts[key]) / (total || 1)}%` });
  return h(
    'div',
    {
      class: 'bar-mini',
      role: 'img',
      'aria-label': `${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline`,
    },
    seg('online'),
    seg('degraded'),
    seg('offline'),
  );
}

export function dashboardView({ meta }) {
  let range = '24h';
  const techLabel = Object.fromEntries(meta.technologies.map((t) => [t.key, t.label]));

  const stripPanel = h('section', { class: 'panel fleet-strip', 'aria-label': 'Fleet status' });
  const trendTitleNote = h('p', { class: 'panel-sub' }, 'Share of vessels not fully online');
  const trendChartBox = h('div');
  const trendFoot = h('div', { class: 'panel-foot' });
  const alertsBody = h('div');
  const techBody = h('div', { class: 'table-wrap' });
  const providerBody = h('div', { class: 'table-wrap' });

  const trendChart = createTimeChart(trendChartBox, {
    mode: 'bars',
    height: 220,
    yFormat: (v) => `${v}%`,
    label: 'Share of the fleet that is degraded or offline over time',
  });

  const rangeControl = segmented({
    label: 'Time range',
    options: RANGES,
    value: range,
    onChange(value) {
      range = value;
      loadTrend().catch(() => {});
    },
  });

  const el = h(
    'div',
    { class: 'page', style: 'display:grid;gap:16px' },
    stripPanel,
    h(
      'div',
      { class: 'grid-2' },
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('div', null, h('h2', { class: 'panel-title' }, 'Fleet health over time'), trendTitleNote),
          rangeControl,
        ),
        h('div', { class: 'panel-body' }, trendChartBox),
        trendFoot,
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Active alerts')),
        h('div', { style: 'padding-top:8px' }, alertsBody),
      ),
    ),
    h(
      'div',
      { class: 'grid-2 even' },
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('div', null, h('h2', { class: 'panel-title' }, 'Performance by technology'), h('p', { class: 'panel-sub' }, 'Current averages across vessels that are reporting')),
        ),
        h('div', { style: 'padding-top:8px' }, techBody),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('div', null, h('h2', { class: 'panel-title' }, 'Providers'), h('p', { class: 'panel-sub' }, 'Select a provider to see its vessels'))),
        h('div', { style: 'padding-top:8px' }, providerBody),
      ),
    ),
  );

  function renderStrip(summary) {
    const stat = (key, label, value, note, href) =>
      h(href ? 'a' : 'div', { class: `stat stat-${key}`, href }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-note' }, note));

    const awaiting = summary.unknown ? `, ${summary.unknown} awaiting data` : '';
    replace(
      stripPanel,
      h(
        'div',
        { class: 'strip-stats' },
        stat('total', 'Vessels', summary.total, `${summary.byProvider.length} providers${awaiting}`, '#/vessels'),
        stat('online', 'Online', summary.online, `${pctOf(summary.online, summary.total)}% of fleet`, '#/vessels?status=online'),
        stat('degraded', 'Degraded', summary.degraded, `${pctOf(summary.degraded, summary.total)}% of fleet`, '#/vessels?status=degraded'),
        stat('offline', 'Offline', summary.offline, `${pctOf(summary.offline, summary.total)}% of fleet`, '#/vessels?status=offline'),
        stat('availability', 'Availability, 24 h', fmtPct(summary.availability24h), 'Share of time reachable'),
      ),
      compositionBar(summary, summary.total),
    );
  }

  function renderAlerts({ items, total }) {
    if (!items.length) {
      replace(alertsBody, emptyState('No active alerts', 'Every vessel that is reporting is within its limits.'));
      return;
    }
    replace(
      alertsBody,
      h(
        'ul',
        { class: 'alert-list' },
        items.map((alert) =>
          h(
            'li',
            { class: 'alert-item' },
            h(
              'div',
              { class: 'alert-item-top' },
              h('a', { class: 'alert-item-name', href: `#/vessels/${alert.vesselId}` }, alert.vesselName),
              statusBadge(alert.type),
            ),
            h('div', { class: 'alert-item-msg' }, alert.message),
            h('div', { class: 'alert-item-time' }, `Since ${timeAgo(alert.openedAt).replace(' ago', '')} ago`),
          ),
        ),
      ),
      h('div', { class: 'panel-foot' }, h('a', { href: '#/alerts' }, total > items.length ? `View all ${total} active alerts` : 'Open alerts page')),
    );
  }

  function renderTech(rows) {
    replace(
      techBody,
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Technology'),
            h('th', { class: 'num' }, 'Vessels'),
            h('th', { class: 'num' }, 'Latency'),
            h('th', { class: 'num' }, 'Down'),
            h('th', { class: 'num hide-sm' }, 'Up'),
            h('th', { class: 'num hide-sm' }, 'Loss'),
          ),
        ),
        h(
          'tbody',
          null,
          rows.map((row) =>
            h(
              'tr',
              { class: 'clickable', onClick: () => (location.hash = `#/vessels?technology=${row.technology}`) },
              h('td', null, h('a', { href: `#/vessels?technology=${row.technology}`, class: 'cell-main' }, techLabel[row.technology] ?? row.technology)),
              h('td', { class: 'num' }, row.vessels),
              h('td', { class: 'num' }, fmtLatency(row.latencyMs)),
              h('td', { class: 'num' }, fmtSpeed(row.downloadMbps)),
              h('td', { class: 'num hide-sm' }, fmtSpeed(row.uploadMbps)),
              h('td', { class: 'num hide-sm' }, fmtLoss(row.packetLossPct)),
            ),
          ),
        ),
      ),
    );
  }

  function renderProviders(rows) {
    replace(
      providerBody,
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h('tr', null, h('th', null, 'Provider'), h('th', { class: 'num' }, 'Vessels'), h('th', { class: 'hide-sm' }, 'Status'), h('th', { class: 'num' }, 'Need attention')),
        ),
        h(
          'tbody',
          null,
          rows.map((row) => {
            const attention = row.degraded + row.offline;
            return h(
              'tr',
              { class: 'clickable', onClick: () => (location.hash = `#/vessels?providerId=${row.id}`) },
              h('td', null, h('a', { class: 'cell-main', href: `#/vessels?providerId=${row.id}` }, row.name)),
              h('td', { class: 'num' }, row.vessels),
              h('td', { class: 'hide-sm' }, compositionBar(row, row.vessels)),
              h('td', { class: 'num' }, attention ? h('strong', null, attention) : h('span', { class: 'muted' }, 'None')),
            );
          }),
        ),
      ),
    );
  }

  async function loadTrend() {
    const trend = await api.get('/api/dashboard/trend', { range });
    const times = trend.points.map((p) => new Date(p.t).getTime());
    const now = Date.now();
    const spanMs = { '6h': 6, '24h': 24, '7d': 168 }[range] * 3_600_000;

    trendChart.update({
      times,
      from: now - spanMs,
      to: now,
      bucketMs: trend.bucketSeconds * 1000,
      longRange: range === '7d',
      minTop: 10,
      series: [
        { key: 'offline', label: 'Offline', color: 'var(--offline)', values: trend.points.map((p) => p.offlinePct), fmt: (v) => `${v.toFixed(1)}%` },
        { key: 'degraded', label: 'Degraded', color: 'var(--degraded)', values: trend.points.map((p) => p.degradedPct), fmt: (v) => `${v.toFixed(1)}%` },
        { key: 'online', label: 'Online', color: 'var(--online)', values: trend.points.map((p) => p.onlinePct), fmt: (v) => `${v.toFixed(1)}%`, plot: false },
      ],
    });

    replace(
      trendFoot,
      h(
        'div',
        { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap' },
        legend([
          { label: 'Degraded', color: 'var(--degraded)' },
          { label: 'Offline', color: 'var(--offline)' },
        ]),
        h('span', null, `Availability over this period: `, h('strong', null, fmtPct(trend.availability))),
      ),
    );
  }

  return {
    el,
    title: 'Overview',
    async refresh() {
      const [summary, alerts] = await Promise.all([
        api.get('/api/dashboard/summary'),
        api.get('/api/alerts', { state: 'active', pageSize: 6 }),
        loadTrend(),
      ]).then(([a, b]) => [a, b]);
      renderStrip(summary);
      renderAlerts(alerts);
      renderTech(summary.byTechnology);
      renderProviders(summary.byProvider);
    },
    destroy() {
      trendChart.destroy();
    },
  };
}
