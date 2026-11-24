import { api, ApiError } from '../api.js';
import { fmtDateTime, fmtDuration, fmtLatency, fmtLoss, fmtPct, fmtSpeed, timeAgo } from '../format.js';
import { confirmDialog, errorPanel, legend, segmented, statusBadge, toast } from '../ui/components.js';
import { createTimeChart, statusStrip } from '../ui/charts.js';
import { h, replace } from '../ui/dom.js';
import { deleteVessel, openVesselForm } from './vessel-form.js';

const RANGES = [
  { value: '1h', label: '1 h' },
  { value: '6h', label: '6 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
];
const SPAN_MS = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000 };

export function vesselDetailView({ meta, id, navigate }) {
  let range = '24h';
  let vessel = null;
  const techByKey = Object.fromEntries(meta.technologies.map((t) => [t.key, t]));

  const headBox = h('div');
  const factsBox = h('div');
  const metricsBox = h('div');
  const alertsBox = h('div');
  const controlsBox = h('div');
  const summaryBox = h('div');
  const stripBox = h('div');

  const boxes = {
    speed: h('div'),
    latency: h('div'),
    loss: h('div'),
    availability: h('div'),
  };

  const charts = {
    speed: createTimeChart(boxes.speed, { height: 170, yFormat: (v) => String(v), label: 'Download and upload speed over time' }),
    latency: createTimeChart(boxes.latency, { height: 150, yFormat: (v) => `${v} ms`, label: 'Latency over time' }),
    loss: createTimeChart(boxes.loss, { height: 130, yFormat: (v) => `${v}%`, label: 'Packet loss over time' }),
    availability: createTimeChart(boxes.availability, { height: 110, yFormat: (v) => `${v}%`, label: 'Availability over time' }),
  };

  const block = (title, right, body) =>
    h('div', { class: 'chart-block' }, h('div', { class: 'chart-block-head' }, h('span', { class: 'chart-block-title' }, title), right), body);

  const el = h(
    'div',
    { style: 'display:grid;gap:16px' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/vessels' }, 'Vessels'), ' / ', h('span', { id: 'crumb-name' }, '…')),
    headBox,
    h(
      'div',
      { class: 'detail-grid' },
      h(
        'div',
        { class: 'stack' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Vessel details')), h('div', { class: 'panel-body' }, factsBox)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Alert history')), h('div', { style: 'padding-top:8px' }, alertsBox)),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', null, h('h2', { class: 'panel-title' }, 'Demo controls'), h('p', { class: 'panel-sub' }, 'Simulate a problem on this vessel to see alerts react'))), h('div', { class: 'panel-body' }, controlsBox)),
      ),
      h(
        'div',
        { class: 'stack' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Current readings')), h('div', { style: 'padding-top:10px' }, metricsBox)),
        h(
          'section',
          { class: 'panel' },
          h(
            'div',
            { class: 'panel-head' },
            h('div', null, h('h2', { class: 'panel-title' }, 'Connectivity history')),
            segmented({
              label: 'Time range',
              options: RANGES,
              value: range,
              onChange(value) {
                range = value;
                loadHistory().catch((err) => toast(err.message, 'error'));
              },
            }),
          ),
          h(
            'div',
            { class: 'panel-body' },
            summaryBox,
            h('div', { class: 'chart-block' }, h('div', { class: 'chart-block-head' }, h('span', { class: 'chart-block-title' }, 'Status')), stripBox),
            block('Download and upload', legend([{ label: 'Download (Mbps)', color: 'var(--c-download)' }, { label: 'Upload (Mbps)', color: 'var(--c-upload)' }]), boxes.speed),
            block('Latency', null, boxes.latency),
            block('Packet loss', null, boxes.loss),
            block('Availability', null, boxes.availability),
          ),
        ),
      ),
    ),
  );

  function renderHead() {
    const edit = () =>
      openVesselForm({
        meta,
        vessel,
        onSaved: () => refresh().catch(() => {}),
      });

    const remove = async () => {
      const ok = await confirmDialog({
        title: `Delete ${vessel.name}?`,
        message: 'This removes the vessel together with its connectivity history and alerts. It cannot be undone.',
        confirmLabel: 'Delete vessel',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteVessel(vessel);
        toast(`Deleted ${vessel.name}`);
        navigate('#/vessels');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    el.querySelector('#crumb-name').textContent = vessel.name;
    replace(
      headBox,
      h(
        'div',
        { class: 'detail-head' },
        h(
          'div',
          { class: 'detail-title' },
          h('h2', null, vessel.name),
          statusBadge(vessel.status),
          vessel.status !== 'unknown' && h('span', { class: 'muted' }, `for ${timeAgo(vessel.statusSince).replace(' ago', '')}`),
        ),
        h(
          'div',
          { class: 'detail-actions' },
          h('button', { class: 'btn', type: 'button', onClick: edit }, 'Edit'),
          h('button', { class: 'btn btn-ghost-danger', type: 'button', onClick: remove }, 'Delete'),
        ),
      ),
    );
  }

  function renderFacts() {
    const row = (label, value) => [h('dt', null, label), h('dd', null, value ?? '—')];
    replace(
      factsBox,
      h(
        'dl',
        { class: 'facts' },
        row('IMO number', vessel.imoNumber),
        row('Call sign', vessel.callSign),
        row('Type', vessel.vesselType),
        row('Flag', vessel.flag),
        row('Provider', vessel.provider.name),
        row('Technology', techByKey[vessel.technology]?.label ?? vessel.technology),
        row('Last update', vessel.lastReportedAt ? timeAgo(vessel.lastReportedAt) : null),
      ),
    );
  }

  function renderMetrics() {
    const limits = techByKey[vessel.technology]?.thresholds;
    const m = vessel.metrics;
    const offline = vessel.status === 'offline';

    const tile = (label, value, note, breached) =>
      h(
        'div',
        { class: `metric${breached ? ' breach' : ''}${offline ? ' is-offline' : ''}` },
        h('div', { class: 'metric-label' }, label),
        h('div', { class: 'metric-value' }, value),
        h('div', { class: 'metric-note' }, breached ? `Outside limit: ${note}` : note),
      );

    if (!m) {
      replace(metricsBox, h('div', { class: 'panel-body', style: 'padding-top:0' }, offline ? 'The vessel is not reporting. No readings are available.' : 'No readings received yet.'));
      return;
    }

    replace(
      metricsBox,
      h(
        'div',
        { class: 'metric-tiles' },
        tile('Latency', fmtLatency(m.latencyMs), `limit ${fmtLatency(limits.maxLatencyMs)}`, m.latencyMs > limits.maxLatencyMs),
        tile('Download', fmtSpeed(m.downloadMbps), `minimum ${fmtSpeed(limits.minDownMbps)}`, m.downloadMbps < limits.minDownMbps),
        tile('Upload', fmtSpeed(m.uploadMbps), `minimum ${fmtSpeed(limits.minUpMbps)}`, m.uploadMbps < limits.minUpMbps),
        tile('Packet loss', fmtLoss(m.packetLossPct), `limit ${fmtLoss(limits.maxLossPct)}`, m.packetLossPct > limits.maxLossPct),
      ),
    );
  }

  function renderControls() {
    const send = (condition, label) =>
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          async onClick() {
            try {
              await api.post(`/api/simulator/vessels/${vessel.id}/force`, { condition });
              toast(`${vessel.name}: ${label}`);
              await refresh();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        label,
      );
    replace(
      controlsBox,
      h('div', { class: 'sim-controls' }, send('down', 'Take offline'), send('impaired', 'Degrade link'), send('good', 'Restore')),
      h('p', { class: 'form-hint' }, 'The state holds for a few minutes, then the simulator takes over again.'),
    );
  }

  async function loadAlerts() {
    const { items, total } = await api.get('/api/alerts', { state: 'all', vesselId: id, pageSize: 8 });
    if (!items.length) {
      replace(alertsBox, h('p', { class: 'muted', style: 'padding:6px 16px 16px' }, 'No alerts recorded for this vessel.'));
      return;
    }
    replace(
      alertsBox,
      h(
        'ul',
        { class: 'alert-list' },
        items.map((alert) =>
          h(
            'li',
            { class: 'alert-item' },
            h('div', { class: 'alert-item-top' }, statusBadge(alert.type), h('span', { class: 'alert-item-time' }, fmtDateTime(alert.openedAt))),
            h('div', { class: 'alert-item-msg' }, alert.message),
            h('div', { class: 'alert-item-time' }, alert.state === 'active' ? `Active for ${fmtDuration(alert.durationMs)}` : `Lasted ${fmtDuration(alert.durationMs)}`),
          ),
        ),
      ),
      total > items.length && h('div', { class: 'panel-foot' }, h('a', { href: '#/alerts' }, 'See all alerts')),
    );
  }

  async function loadHistory() {
    const data = await api.get(`/api/vessels/${id}/history`, { range });
    const limits = techByKey[vessel.technology].thresholds;
    const times = data.points.map((p) => new Date(p.t).getTime());
    const to = new Date(data.to).getTime();
    const common = { times, from: to - SPAN_MS[range], to, bucketMs: data.bucketSeconds * 1000, longRange: range === '7d' };
    const col = (key) => data.points.map((p) => p[key]);

    const sm = data.summary;
    const stat = (k, v) => h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    replace(
      summaryBox,
      h(
        'div',
        { class: 'summary-row' },
        stat('Availability', fmtPct(sm.availability)),
        stat('Avg latency', fmtLatency(sm.avgLatencyMs == null ? null : Math.round(sm.avgLatencyMs))),
        stat('Avg download', fmtSpeed(sm.avgDownloadMbps)),
        stat('Offline incidents', sm.offlineIncidents),
        stat('Time offline', fmtDuration(sm.offlineMs)),
      ),
    );

    replace(
      stripBox,
      statusStrip(data.points),
      h('div', { class: 'strip-axis' }, h('span', null, fmtDateTime(data.from)), h('span', null, 'Now')),
    );

    charts.speed.update({
      ...common,
      series: [
        { label: 'Download', color: 'var(--c-download)', values: col('downloadMbps'), fmt: fmtSpeed },
        { label: 'Upload', color: 'var(--c-upload)', values: col('uploadMbps'), fmt: fmtSpeed },
      ],
    });
    charts.latency.update({
      ...common,
      limit: { value: limits.maxLatencyMs, label: `Limit ${limits.maxLatencyMs} ms` },
      series: [{ label: 'Latency', color: 'var(--c-latency)', values: col('latencyMs'), fmt: fmtLatency }],
    });
    charts.loss.update({
      ...common,
      limit: { value: limits.maxLossPct, label: `Limit ${limits.maxLossPct}%` },
      series: [{ label: 'Packet loss', color: 'var(--c-loss)', values: col('packetLossPct'), fmt: fmtLoss }],
    });
    charts.availability.update({
      ...common,
      minTop: 100,
      series: [{ label: 'Availability', color: 'var(--online)', values: col('availability'), fmt: (v) => fmtPct(v) }],
    });
  }

  async function refresh() {
    try {
      vessel = await api.get(`/api/vessels/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        replace(el, errorPanel('This vessel no longer exists.', () => navigate('#/vessels')));
        return;
      }
      throw err;
    }
    renderHead();
    renderFacts();
    renderMetrics();
    renderControls();
    await Promise.all([loadHistory(), loadAlerts()]);
  }

  return {
    el,
    title: 'Vessel',
    refresh,
    destroy() {
      Object.values(charts).forEach((c) => c.destroy());
    },
  };
}
