import { TECHNOLOGIES } from './technologies.js';

 
export function classify(reading, technology) {
  const profile = TECHNOLOGIES[technology];
  if (!profile) throw new Error(`Unknown technology: ${technology}`);

  if (!reading.linkUp) {
    return { status: 'offline', reasons: [{ metric: 'link', value: null, limit: null }] };
  }

  const t = profile.thresholds;
  const reasons = [];

  if (reading.latencyMs > t.maxLatencyMs) {
    reasons.push({ metric: 'latency', value: reading.latencyMs, limit: t.maxLatencyMs });
  }
  if (reading.downloadMbps < t.minDownMbps) {
    reasons.push({ metric: 'download', value: reading.downloadMbps, limit: t.minDownMbps });
  }
  if (reading.uploadMbps < t.minUpMbps) {
    reasons.push({ metric: 'upload', value: reading.uploadMbps, limit: t.minUpMbps });
  }
  if (reading.packetLossPct > t.maxLossPct) {
    reasons.push({ metric: 'packet loss', value: reading.packetLossPct, limit: t.maxLossPct });
  }

  return { status: reasons.length ? 'degraded' : 'online', reasons };
}

const UNITS = { latency: 'ms', download: 'Mbps', upload: 'Mbps', 'packet loss': '%' };

/** Human readable text for an alert, e.g. "Latency 1,240 ms (limit 900 ms)". */
export function describeReasons(reasons) {
  return reasons
    .map(({ metric, value, limit }) => {
      const unit = UNITS[metric] ?? '';
      const label = metric.charAt(0).toUpperCase() + metric.slice(1);
      const fmt = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit === '%' ? '' : ' '}${unit}`;
      return `${label} ${fmt(value)} (limit ${fmt(limit)})`;
    })
    .join('; ');
}
