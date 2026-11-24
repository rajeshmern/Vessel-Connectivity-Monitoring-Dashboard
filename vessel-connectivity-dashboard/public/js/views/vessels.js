import { api } from '../api.js';
import { DASH_CHAR, fmtLatency, fmtLoss, fmtPct, fmtSpeed, timeAgo } from '../format.js';
import { emptyState, errorPanel, pager, statusBadge } from '../ui/components.js';
import { h, replace } from '../ui/dom.js';
import { openVesselForm } from './vessel-form.js';

const PAGE_SIZE = 15;

const COLUMNS = [
  { key: 'name', label: 'Vessel', sort: 'name' },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'provider', label: 'Provider', sort: 'provider', cls: 'hide-md' },
  { key: 'technology', label: 'Technology', sort: 'technology', cls: 'hide-lg' },
  { key: 'latency', label: 'Latency', sort: 'latency', num: true },
  { key: 'download', label: 'Download', sort: 'download', num: true, cls: 'hide-sm' },
  { key: 'upload', label: 'Upload', sort: 'upload', num: true, cls: 'hide-lg' },
  { key: 'loss', label: 'Packet loss', sort: 'loss', num: true, cls: 'hide-md' },
  { key: 'availability', label: 'Availability, 24 h', cls: 'hide-lg' },
];

// Filters live in the URL so a filtered view can be bookmarked or shared,
// and so the Overview page can link straight into one.
function readFilters(query) {
  return {
    search: query.get('search') ?? '',
    status: query.get('status') ?? '',
    providerId: query.get('providerId') ?? '',
    technology: query.get('technology') ?? '',
    sort: query.get('sort') ?? '',
    order: query.get('order') ?? 'asc',
    page: Number(query.get('page')) || 1,
  };
}

function writeFilters(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === '' || value === undefined) continue;
    if (key === 'page' && value === 1) continue;
    if (key === 'order' && !filters.sort) continue;
    params.set(key, value);
  }
  const qs = params.toString();
  history.replaceState(null, '', `#/vessels${qs ? `?${qs}` : ''}`);
}

function option(value, label, selected) {
  return h('option', { value, selected: selected === value }, label);
}

export function vesselsView({ meta, query, navigate }) {
  const filters = readFilters(query);
  const techLabel = Object.fromEntries(meta.technologies.map((t) => [t.key, t.label]));
  let lastTotal = 0;
  let searchTimer;

  const results = h('div');
  const countNote = h('p', { class: 'panel-sub' });

  const searchInput = h('input', {
    class: 'input',
    id: 'f-search',
    type: 'search',
    placeholder: 'Name, IMO, call sign or provider',
    value: filters.search,
    autocomplete: 'off',
    onInput() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.search = searchInput.value.trim();
        filters.page = 1;
        load();
      }, 250);
    },
  });

  const select = (id, label, key, options) => {
    const el = h(
      'select',
      {
        class: 'select',
        id,
        onChange() {
          filters[key] = el.value;
          filters.page = 1;
          load();
        },
      },
      options,
    );
    return h('div', { class: 'field' }, h('label', { for: id }, label), el);
  };

  const statusSelect = select('f-status', 'Status', 'status', [
    option('', 'All statuses', filters.status),
    option('offline', 'Offline', filters.status),
    option('degraded', 'Degraded', filters.status),
    option('online', 'Online', filters.status),
  ]);
  const providerSelect = select('f-provider', 'Provider', 'providerId', [
    option('', 'All providers', filters.providerId),
    ...meta.providers.map((p) => option(String(p.id), p.name, filters.providerId)),
  ]);
  const techSelect = select('f-tech', 'Technology', 'technology', [
    option('', 'All technologies', filters.technology),
    ...meta.technologies.map((t) => option(t.key, t.label, filters.technology)),
  ]);

  const clearBtn = h('button', { class: 'btn', type: 'button', onClick: clearAll }, 'Clear filters');
  const addBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: () =>
        openVesselForm({
          meta,
          onSaved(vessel) {
            navigate(`#/vessels/${vessel.id}`);
          },
        }),
    },
    'Add vessel',
  );

  function clearAll() {
    Object.assign(filters, { search: '', status: '', providerId: '', technology: '', page: 1 });
    searchInput.value = '';
    for (const [el, value] of [[statusSelect, ''], [providerSelect, ''], [techSelect, '']]) {
      el.querySelector('select').value = value;
    }
    load();
  }

  const el = h(
    'section',
    { class: 'panel' },
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'field grow' }, h('label', { for: 'f-search' }, 'Search'), searchInput),
      statusSelect,
      providerSelect,
      techSelect,
      h('div', { class: 'spacer' }),
      clearBtn,
      addBtn,
    ),
    results,
  );

  function sortHeader(col) {
    const active = filters.sort === col.sort;
    const th = h('th', {
      class: [col.num ? 'num' : '', col.cls ?? ''].join(' ').trim(),
      scope: 'col',
      'aria-sort': active ? (filters.order === 'desc' ? 'descending' : 'ascending') : undefined,
    });
    if (!col.sort) {
      th.append(col.label);
      return th;
    }
    th.append(
      h(
        'button',
        {
          class: 'sort-btn',
          type: 'button',
          onClick() {
            if (filters.sort === col.sort) filters.order = filters.order === 'asc' ? 'desc' : 'asc';
            else Object.assign(filters, { sort: col.sort, order: 'asc' });
            filters.page = 1;
            load();
          },
        },
        col.label,
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, active && filters.order === 'desc' ? '▼' : '▲'),
      ),
    );
    return th;
  }

  function row(vessel) {
    const m = vessel.metrics;
    const open = () => navigate(`#/vessels/${vessel.id}`);
    const metric = (value, fmt) => (m ? fmt(value) : h('span', { class: 'dash' }, DASH_CHAR));

    return h(
      'tr',
      { class: `clickable row-${vessel.status}`, onClick: open },
      h(
        'td',
        null,
        h('a', { class: 'cell-main', href: `#/vessels/${vessel.id}`, onClick: (e) => e.stopPropagation() }, vessel.name),
        h('div', { class: 'cell-sub' }, `IMO ${vessel.imoNumber} · ${vessel.vesselType}`),
      ),
      h('td', null, statusBadge(vessel.status), vessel.status !== 'unknown' && h('div', { class: 'cell-sub' }, `for ${timeAgo(vessel.statusSince).replace(' ago', '')}`)),
      h('td', { class: 'hide-md' }, vessel.provider.name),
      h('td', { class: 'hide-lg' }, techLabel[vessel.technology] ?? vessel.technology),
      h('td', { class: 'num' }, metric(m?.latencyMs, fmtLatency)),
      h('td', { class: 'num hide-sm' }, metric(m?.downloadMbps, fmtSpeed)),
      h('td', { class: 'num hide-lg' }, metric(m?.uploadMbps, fmtSpeed)),
      h('td', { class: 'num hide-md' }, metric(m?.packetLossPct, fmtLoss)),
      h('td', { class: 'hide-lg' }, fmtPct(vessel.availability24h)),
    );
  }

  function renderTable(data) {
    lastTotal = data.total;
    const active = filters.search || filters.status || filters.providerId || filters.technology;
    clearBtn.hidden = !active;

    if (!data.items.length) {
      replace(
        results,
        active
          ? emptyState('No vessels match these filters', 'Try a different search or clear the filters.', h('button', { class: 'btn', type: 'button', onClick: clearAll }, 'Clear filters'))
          : emptyState('No vessels yet', 'Add a vessel to start monitoring its connection.'),
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
          h('thead', null, h('tr', null, COLUMNS.map(sortHeader))),
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
    writeFilters(filters);
    try {
      const data = await api.get('/api/vessels', {
        search: filters.search,
        status: filters.status,
        providerId: filters.providerId,
        technology: filters.technology,
        sort: filters.sort,
        order: filters.sort ? filters.order : '',
        page: filters.page,
        pageSize: PAGE_SIZE,
      });
      if (mine !== requestId) return; // a newer request already answered
      renderTable(data);
    } catch (err) {
      if (mine !== requestId || quiet) throw err;
      replace(results, errorPanel(`Could not load vessels. ${err.message}`, () => load()));
    }
  }

  return {
    el,
    title: 'Vessels',
    refresh: () => load({ quiet: true }),
    get total() {
      return lastTotal;
    },
  };
}
