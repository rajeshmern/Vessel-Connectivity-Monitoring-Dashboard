const DASH = '—';

const num = (n, digits = 0) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtLatency(ms) {
  return ms == null ? DASH : `${num(ms)} ms`;
}

// L-band links run at a few hundred kbps, so show those in kbps.
export function fmtSpeed(mbps) {
  if (mbps == null) return DASH;
  if (mbps < 1) return `${num(mbps * 1000)} kbps`;
  if (mbps < 100) return `${num(mbps, 1)} Mbps`;
  return `${num(mbps)} Mbps`;
}

export function fmtLoss(pct) {
  if (pct == null) return DASH;
  return `${num(pct, pct < 1 ? 2 : 1)}%`;
}

export function fmtPct(value, digits = 1) {
  return value == null ? DASH : `${num(value, digits)}%`;
}

export function fmtDuration(ms) {
  if (ms == null) return DASH;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours < 24) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} d ${remHours} h` : `${days} d`;
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return DASH;
  const diff = now - new Date(iso).getTime();
  if (diff < 45_000) return 'just now';
  return `${fmtDuration(diff)} ago`;
}

export function fmtDateTime(iso) {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtClock(ms, withSeconds = false) {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds && { second: '2-digit' }),
  });
}

export function fmtDay(ms) {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

export const DASH_CHAR = DASH;
