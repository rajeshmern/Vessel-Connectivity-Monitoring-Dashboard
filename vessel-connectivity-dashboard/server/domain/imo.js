 
function checkDigitFor(sixDigits) {
  const sum = [...sixDigits].reduce((acc, d, i) => acc + Number(d) * (7 - i), 0);
  return sum % 10;
}

export function normalizeImo(value) {
  return String(value ?? '').trim().replace(/^IMO\s*/i, '');
}

export function isValidImo(value) {
  const imo = normalizeImo(value);
  if (!/^\d{7}$/.test(imo)) return false;
  return checkDigitFor(imo.slice(0, 6)) === Number(imo[6]);
}

/** Builds a valid IMO number from a 6 digit prefix. Used by the seed data. */
export function imoFromPrefix(prefix) {
  const six = String(prefix).padStart(6, '0');
  return `${six}${checkDigitFor(six)}`;
}
