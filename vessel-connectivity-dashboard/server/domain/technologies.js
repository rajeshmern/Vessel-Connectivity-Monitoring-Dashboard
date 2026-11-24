 export const TECHNOLOGIES = {
  LEO: {
    label: 'LEO (Starlink-class)',
    baseline: { latencyMs: 48, downMbps: 140, upMbps: 22, lossPct: 0.3 },
    thresholds: { maxLatencyMs: 150, minDownMbps: 30, minUpMbps: 5, maxLossPct: 2 },
  },
  VSAT_KU: {
    label: 'VSAT Ku-band (GEO)',
    baseline: { latencyMs: 640, downMbps: 14, upMbps: 3.5, lossPct: 0.7 },
    thresholds: { maxLatencyMs: 900, minDownMbps: 5, minUpMbps: 1, maxLossPct: 3 },
  },
  VSAT_KA: {
    label: 'VSAT Ka-band (GEO)',
    baseline: { latencyMs: 660, downMbps: 28, upMbps: 5, lossPct: 0.6 },
    thresholds: { maxLatencyMs: 900, minDownMbps: 8, minUpMbps: 1.5, maxLossPct: 3 },
  },
  LBAND: {
    label: 'L-band',
    baseline: { latencyMs: 820, downMbps: 0.45, upMbps: 0.3, lossPct: 1.2 },
    thresholds: { maxLatencyMs: 1400, minDownMbps: 0.15, minUpMbps: 0.1, maxLossPct: 5 },
  },
  LTE: {
    label: '4G/LTE (coastal)',
    baseline: { latencyMs: 55, downMbps: 45, upMbps: 14, lossPct: 0.5 },
    thresholds: { maxLatencyMs: 150, minDownMbps: 10, minUpMbps: 3, maxLossPct: 3 },
  },
};

export const TECHNOLOGY_KEYS = Object.keys(TECHNOLOGIES);

export const VESSEL_TYPES = [
  'Container Ship',
  'Bulk Carrier',
  'Oil Tanker',
  'Chemical Tanker',
  'LNG Carrier',
  'Car Carrier',
  'General Cargo',
  'Offshore Support',
  'Ro-Ro Ferry',
  'Cruise Ship',
];

export const STATUSES = ['online', 'degraded', 'offline'];
