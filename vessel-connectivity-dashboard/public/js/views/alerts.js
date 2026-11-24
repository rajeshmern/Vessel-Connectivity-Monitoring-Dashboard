import { api } from '../api.js';
import { fmtDateTime, fmtDuration } from '../format.js';
import { emptyState, errorPanel, pager, segmented, statusBadge, toast } from '../ui/components.js';
import { h, replace } from '../ui/dom.js';

const PAGE_SIZE = 15;

const STATES = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function alertsView({ query }) {
  const filters = {
    state: ['active', 'resolved', 'all'].includes(query.get('state')) ? query.get('state') : 'active',
    type: ['offline', 'degraded'].includes(query.get('type')) ? query.get('type') : '',
    page: 1,
  };

  const results = h('div');

  const typeSelect = h(
    'select',
    {
      class: 'select',
      id: 'a-type',
      onChange() {
        filters.type = typeSelect.value;
        filters.page = 1;
        load();
      },
    },
    h('option', { value: '' }, 'Offline and degraded'),
    h('option', { value: 'offline', selected: filters.type === 'offline' }, 'Offline only'),
    h('option', { value: 'degraded', selected: filters.type === 'degraded' }, 'Degraded only'),
  );

  const el = h(
    'section',
    { class: 'panel' },
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'field', style: 'flex:0 0 auto' },
        h('label', null, 'Show'),
        segmented({
          label: 'Alert state',
          options: STATES,
          value: filters.state,
          onChange(value) {
            filters.state = value;
            filters.page = 1;
            load();
          },
        }),
      ),
      h('div', { class: 'field' }, h('label', { for: 'a-type' }, 'Type'), typeSelect),
    ),
    results,
  );

  async function acknowledge(alert) {
    try {
      await api.post(`/api/alerts/${alert.id}/acknowledge`);
      toast(`Acknowledged alert for ${alert.vesselName}`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function row(alert) {
    const active = alert.state === 'active';
    return h(
      'tr',
      { class: active ? `row-${alert.type}` : '' },
      h('td', null, h('a', { class: 'cell-main', href: `#/vessels/${alert.vesselId}` }, alert.vesselName), h('div', { class: 'cell-sub' }, `IMO ${alert.vesselImo}`)),
      h('td', null, statusBadge(alert.type)),
      h('td', null, alert.message),
      h('td', { class: 'hide-md' }, fmtDateTime(alert.openedAt)),
      h('td', { class: 'num' }, active ? h('strong', null, fmtDuration(alert.durationMs)) : fmtDuration(alert.durationMs)),
      h(
        'td',
        { class: 'hide-sm' },
        active
          ? alert.acknowledgedAt
            ? h('span', { class: 'muted' }, 'Acknowledged')
            : h('button', { class: 'btn btn-sm', type: 'button', onClick: () => acknowledge(alert) }, 'Acknowledge')
          : h('span', { class: 'muted' }, 'Resolved'),
      ),
    );
  }

  function render(data) {
    if (!data.items.length) {
      replace(
        results,
        filters.state === 'active'
          ? emptyState('No active alerts', 'Every vessel that is reporting is within its limits.')
          : emptyState('No alerts found', 'Nothing matches this filter.'),
      );
      return;
    }
    replace(
      results,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, 'Vessel'), h('th', null, 'Type'), h('th', null, 'What happened'), h('th', { class: 'hide-md' }, 'Started'), h('th', { class: 'num' }, 'Duration'), h('th', { class: 'hide-sm' }, 'Action')),
          ),
          h('tbody', null, data.items.map(row)),
        ),
      ),
      pager({
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        onPage(page) {
          filters.page = page;
          load();
        },
      }),
    );
  }

  let requestId = 0;
  async function load({ quiet = false } = {}) {
    const mine = ++requestId;
    try {
      const data = await api.get('/api/alerts', { state: filters.state, type: filters.type, page: filters.page, pageSize: PAGE_SIZE });
      if (mine === requestId) render(data);
    } catch (err) {
      if (mine !== requestId || quiet) throw err;
      replace(results, errorPanel(`Could not load alerts. ${err.message}`, () => load()));
    }
  }

  return { el, title: 'Alerts', refresh: () => load({ quiet: true }) };
}
