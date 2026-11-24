import { h } from './dom.js';

export const STATUS_LABEL = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'No data',
};

export function statusBadge(status) {
  return h(
    'span',
    { class: `badge badge-${status}` },
    h('span', { class: 'badge-dot', 'aria-hidden': 'true' }),
    STATUS_LABEL[status] ?? status,
  );
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', null, title), text && h('p', null, text), action);
}

export function errorPanel(message, onRetry) {
  return h(
    'div',
    { class: 'error-panel', role: 'alert' },
    h('p', null, message),
    onRetry && h('button', { class: 'btn', type: 'button', onClick: onRetry }, 'Try again'),
  );
}

export function pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return h(
    'div',
    { class: 'pager' },
    h('span', null, total ? `Showing ${from}–${to} of ${total}` : 'No results'),
    h(
      'div',
      { class: 'pager-buttons' },
      h('button', { class: 'btn btn-sm', type: 'button', disabled: page <= 1, onClick: () => onPage(page - 1) }, 'Previous'),
      h('span', null, `Page ${page} of ${pages}`),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: page >= pages, onClick: () => onPage(page + 1) }, 'Next'),
    ),
  );
}

export function segmented({ options, value, onChange, label }) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const buttons = options.map((option) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segmented-btn',
        'aria-pressed': String(option.value === value),
        onClick() {
          buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === this)));
          onChange(option.value);
        },
      },
      option.label,
    ),
  );
  wrap.append(...buttons);
  return wrap;
}

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(el);
  setTimeout(() => el.remove(), 4500);
}

export function modal({ title, content }) {
  const dialog = h(
    'dialog',
    { class: 'modal' },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => dialog.close() }, '×'),
    ),
    h('div', { class: 'modal-body' }, content),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const dialog = modal({
      title,
      content: [
        h('p', null, message),
        h(
          'div',
          { class: 'form-actions' },
          h('button', { class: 'btn', type: 'button', onClick: () => dialog.close('cancel') }, 'Cancel'),
          h(
            'button',
            { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onClick: () => dialog.close('confirm') },
            confirmLabel,
          ),
        ),
      ],
    });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'));
  });
}

export function legend(items) {
  return h(
    'div',
    { class: 'legend' },
    items.map(({ label, color }) =>
      h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: `background:${color}` }), label),
    ),
  );
}
