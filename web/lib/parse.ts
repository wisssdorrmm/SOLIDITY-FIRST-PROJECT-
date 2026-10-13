// Pulls NAFDAC number, batch number and dates out of noisy OCR text from a
// medicine pack. Every field is optional: OCR on a shaky phone camera misses
// things, so callers merge results across several frames.

export type MonthYear = { year: number; month: number }; // month is 1-12

export type PackFields = {
  nafdacNo?: string;
  batchNo?: string;
  mfd?: MonthYear;
  exp?: MonthYear;
  hasNafdacLabel: boolean;
};

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Canonical NAFDAC registration number, e.g. "a4 – 1234" -> "A4-1234". */
export function normalizeNafdac(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[‐-―−_]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^NAFDAC(REG(ISTRATION)?)?(\.|NO\.?|NUMBER|:)*/, "");
}

/** Canonical batch/lot number: uppercase, no spaces. */
export function normalizeBatch(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[.:]+$/, "");
}

/** Plausible NAFDAC registration number: optional letters, 1-2 digits, dash, 4-5 digits, optional L. */
export const NAFDAC_PATTERN = /^[A-Z]{0,2}\d{1,2}-\d{4,5}L?$/;

export function isValidNafdacFormat(no: string): boolean {
  return NAFDAC_PATTERN.test(normalizeNafdac(no));
}

function cleanText(text: string): string {
  // Common OCR confusions inside label keywords only; values are handled separately.
  return text.replace(/\r/g, "").replace(/[|]/g, "I");
}

function findNafdac(text: string): { no?: string; label: boolean } {
  const label = /NAF\s*DAC/i.test(text);
  // Prefer a number that follows the NAFDAC label.
  const labelled = text.match(/NAF\s*DAC[^A-Z0-9\n]{0,6}(?:REG(?:ISTRATION)?\.?\s*)?(?:N[O0]\.?|NUMBER)?\s*[:.#]?\s*([A-Z]{0,2}\s?\d{1,2}\s?[-‐-―]\s?\d{4,5}L?)/i);
  if (labelled) return { no: normalizeNafdac(labelled[1]), label };
  const loose = text.match(/\b([A-Z]{0,2}\d{1,2}\s?[-‐-―]\s?\d{4,5}L?)\b/i);
  if (loose && label) return { no: normalizeNafdac(loose[1]), label };
  return { label };
}

function findBatch(text: string): string | undefined {
  const m = text.match(/(?:BATCH|B\.\s?N[O0]\.?|B\/N|BN|LOT)\s*(?:N[O0]\.?|NUMBER)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,15})/i);
  if (!m) return undefined;
  const value = normalizeBatch(m[1]);
  // "BATCH NO" followed by nothing useful can capture label words.
  if (/^(NO|NUMBER|MFD|MFG|EXP)$/.test(value)) return undefined;
  return value;
}

function toYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Parses "05/2025", "05-25", "MAY 2025", "2025-05", "12/05/2025", "MAY.25". */
export function parseMonthYear(raw: string): MonthYear | undefined {
  const s = raw.toUpperCase().trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/); // DD/MM/YYYY
  if (m) return valid(toYear(m[3]), Number(m[2]));
  m = s.match(/^(\d{4})[\/.\-](\d{1,2})$/); // YYYY-MM
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})[\/.\-](\d{2}|\d{4})$/); // MM/YYYY
  if (m) return valid(toYear(m[2]), Number(m[1]));
  m = s.match(/^([A-Z]{3,4})[A-Z]*[\s.\-\/,]*(\d{2}|\d{4})$/); // MAY 2025
  if (m && MONTHS[m[1]]) return valid(toYear(m[2]), MONTHS[m[1]]);
  return undefined;
}

function valid(year: number, month: number): MonthYear | undefined {
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return undefined;
  return { year, month };
}

const DATE_VALUE = String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}|\d{1,2}[\/.\-]\d{2,4}|[A-Z]{3,9}[\s.\-\/,]*\d{2,4})`;

function findDate(text: string, labels: string): MonthYear | undefined {
  const re = new RegExp(`(?:${labels})\\.?\\s*(?:DATE)?\\s*[:.]?\\s*${DATE_VALUE}`, "i");
  const m = text.match(re);
  return m ? parseMonthYear(m[1]) : undefined;
}

export function parsePackText(text: string): PackFields {
  const t = cleanText(text);
  const nafdac = findNafdac(t);
  return {
    nafdacNo: nafdac.no,
    hasNafdacLabel: nafdac.label,
    batchNo: findBatch(t),
    mfd: findDate(t, "MFD|MFG|MANUFACTURED|MANUF|MF\\s?D|PROD"),
    exp: findDate(t, "EXP(?:IRY)?|EXPIRES|EXPIRATION|USE\\s?BY|BEST\\s?BEFORE"),
  };
}

/** Merges fields from a new frame into what we already have (first good value wins). */
export function mergeFields(prev: PackFields, next: PackFields): PackFields {
  return {
    nafdacNo: prev.nafdacNo ?? next.nafdacNo,
    batchNo: prev.batchNo ?? next.batchNo,
    mfd: prev.mfd ?? next.mfd,
    exp: prev.exp ?? next.exp,
    hasNafdacLabel: prev.hasNafdacLabel || next.hasNafdacLabel,
  };
}

export function formatMonthYear(d?: MonthYear): string {
  if (!d) return "—";
  return `${String(d.month).padStart(2, "0")}/${d.year}`;
}
