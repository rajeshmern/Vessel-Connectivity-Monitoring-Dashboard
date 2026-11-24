import { badRequest } from './errors.js';

const blank = (v) => v === undefined || v === null || v === '';

export function intParam(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (blank(value)) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

export function oneOf(value, allowed, name, fallback) {
  if (blank(value)) return fallback;
  if (!allowed.includes(value)) {
    throw badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function pageParams(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = intParam(query.page, 'page', { fallback: 1 });
  const pageSize = intParam(query.pageSize, 'pageSize', { max: maxSize, fallback: defaultSize });
  return { page, pageSize, offset: (page - 1) * pageSize };
}
