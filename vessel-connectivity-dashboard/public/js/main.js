import { api } from './api.js';
import { timeAgo } from './format.js';
import { errorPanel, toast } from './ui/components.js';
import { h, replace } from './ui/dom.js';
import { alertsView } from './views/alerts.js';
import { dashboardView } from './views/dashboard.js';
import { vesselDetailView } from './views/vessel-detail.js';
import { vesselsView } from './views/vessels.js';

const REFRESH_MS = 15_000;

const viewRoot = document.getElementById('view');
const pageTitle = document.getElementById('page-title');
const live = document.getElementById('live-indicator');
const alertCount = document.getElementById('nav-alert-count');
const simPanel = document.getElementById('sim-panel');

let meta;
let current = null;
let lastUpdated = null;
let failures = 0;

// "#/vessels/12?status=online" -> { path: ['vessels', '12'], query: URLSearchParams }
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  return { path: pathPart.split('/').filter(Boolean), query: new URLSearchParams(queryPart) };
}

const navigate = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function showLive() {
  if (failures > 0) {
    live.className = 'live stale';
    live.textContent = 'Connection lost. Retrying…';
  } else if (lastUpdated) {
    live.className = 'live';
    live.textContent = `Updated ${timeAgo(new Date(lastUpdated).toISOString())}`;
  }
}

async function refreshChrome() {
  const [summary, sim] = await Promise.all([api.get('/api/dashboard/summary'), api.get('/api/simulator')]);
  const open = summary.openAlerts.offline + summary.openAlerts.degraded;
  alertCount.hidden = open === 0;
  alertCount.textContent = open;
  renderSimPanel(sim);
}

function renderSimPanel(sim) {
  const toggle = async () => {
    try {
      await api.post(`/api/simulator/${sim.running ? 'pause' : 'resume'}`);
      toast(sim.running ? 'Simulated updates paused' : 'Simulated updates resumed');
      await refreshChrome();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  replace(
    simPanel,
    h('div', { class: 'sim-state' }, h('span', { class: `sim-dot${sim.running ? '' : ' paused'}` }), sim.running ? 'Simulated data is on' : 'Simulated data is paused'),
    h('p', { class: 'sim-note' }, sim.running ? `New readings every ${sim.intervalMs / 1000} s` : 'Readings are frozen'),
    h('button', { class: 'btn btn-sm', type: 'button', onClick: toggle }, sim.running ? 'Pause updates' : 'Resume updates'),
  );
}

async function refreshCurrent({ initial = false } = {}) {
  try {
    await Promise.all([current?.refresh(), initial ? null : refreshChrome()]);
    failures = 0;
    lastUpdated = Date.now();
  } catch (err) {
    failures += 1;
    console.error(err);
  }
  showLive();
}

function viewFor({ path, query }) {
  const [section, id] = path;
  if (!section) return { name: 'dashboard', make: () => dashboardView({ meta }) };
  if (section === 'vessels' && id) return { name: 'vessels', make: () => vesselDetailView({ meta, id: Number(id), navigate }) };
  if (section === 'vessels') return { name: 'vessels', make: () => vesselsView({ meta, query, navigate }) };
  if (section === 'alerts') return { name: 'alerts', make: () => alertsView({ query }) };
  return null;
}

async function route() {
  current?.destroy?.();
  current = null;

  const target = viewFor(parseHash());
  if (!target) {
    setActiveNav(null);
    pageTitle.textContent = 'Page not found';
    replace(viewRoot, h('section', { class: 'panel' }, h('div', { class: 'empty' }, h('h3', null, 'This page does not exist'), h('a', { class: 'btn', href: '#/' }, 'Back to overview'))));
    return;
  }

  setActiveNav(target.name);
  const view = target.make();
  current = view;
  pageTitle.textContent = view.title;
  replace(viewRoot, view.el);
  window.scrollTo(0, 0);

  await refreshCurrent({ initial: true });
  refreshChrome().catch(() => {});
}

async function start() {
  try {
    meta = await api.get('/api/meta');
  } catch (err) {
    replace(viewRoot, h('section', { class: 'panel' }, errorPanel(`Could not reach the server. ${err.message}`, () => location.reload())));
    return;
  }

  window.addEventListener('hashchange', route);
  await route();

  setInterval(() => {
    if (!document.hidden) refreshCurrent();
  }, REFRESH_MS);
  setInterval(showLive, 5_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCurrent();
  });
}

start();
