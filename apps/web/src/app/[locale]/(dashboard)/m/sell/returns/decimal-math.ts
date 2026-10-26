/**
 * Exact decimal arithmetic for the live totals preview (BigInt, no floating point). It mirrors the API rule
 * `computeReturnTotals`; the server recomputes everything when the return is saved, so this is display only.
 */
export interface Dec {
  /** value = n / 10^s */
  n: bigint;
  s: number;
}

const TEN = BigInt(10);
const pow10 = (e: number): bigint => TEN ** BigInt(e);

export const ZERO: Dec = { n: BigInt(0), s: 0 };

/** Parses "12.50" / "12" / "-3.1". Returns null for anything else (empty, letters, exponent). */
export function parseDec(input: string | number | null | undefined): Dec | null {
  if (input === null || input === undefined) return null;
  const t = String(input).trim().replace(/,/g, '');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2] || '0'}${frac}`) * (m[1] ? BigInt(-1) : BigInt(1));
  return { n, s: frac.length };
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

export const add = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { n: x + y, s };
};
export const sub = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { n: x - y, s };
};
export const mul = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s });
export const cmp = (a: Dec, b: Dec): number => {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const isNeg = (a: Dec): boolean => a.n < BigInt(0);
export const isZero = (a: Dec): boolean => a.n === BigInt(0);

/** a / 100 (exact: only moves the decimal point). */
export const div100 = (a: Dec): Dec => ({ n: a.n, s: a.s + 2 });

/** Rounds half away from zero to `places` decimals. */
export function round(a: Dec, places: number): Dec {
  if (a.s <= places) return { n: a.n * pow10(places - a.s), s: places };
  const f = pow10(a.s - places);
  const neg = a.n < BigInt(0);
  const abs = neg ? -a.n : a.n;
  let q = abs / f;
  if ((abs % f) * BigInt(2) >= f) q += BigInt(1);
  return { n: neg ? -q : q, s: places };
}

/** "1234.50" text with exactly `places` decimals. */
export function toFixed(a: Dec, places = 4): string {
  const r = round(a, places);
  const neg = r.n < BigInt(0);
  const digits = (neg ? -r.n : r.n).toString().padStart(places + 1, '0');
  const int = digits.slice(0, digits.length - places);
  const frac = digits.slice(digits.length - places);
  return `${neg ? '-' : ''}${int}${places > 0 ? `.${frac}` : ''}`;
}

export interface PreviewLine {
  /** Quantity in the unit of the sale line, as typed. */
  quantity: string;
  /** Unit price (incl. tax) per that same unit. */
  unitPrice: string;
}

export interface PreviewTotals {
  lines: string[];
  totalBeforeTax: string;
  discount: string;
  tax: string;
  finalTotal: string;
}

/** total_before_tax = sum(qty*price); discount fixed or %; tax% on (total - discount); final = total + tax - discount. */
export function previewTotals(lines: PreviewLine[], discountType: string, discountAmount: string, taxRate: string): PreviewTotals {
  let tbt = ZERO;
  const lineTotals: string[] = [];
  for (const l of lines) {
    const q = parseDec(l.quantity);
    const p = parseDec(l.unitPrice);
    const t = q && p ? mul(q, p) : ZERO;
    lineTotals.push(toFixed(t, 2));
    tbt = add(tbt, t);
  }
  const amount = parseDec(discountAmount) ?? ZERO;
  let discount = ZERO;
  if (discountType === 'fixed') discount = amount;
  else if (discountType === 'percentage') discount = div100(mul(amount, tbt));
  const rate = parseDec(taxRate) ?? ZERO;
  const tax = isZero(rate) ? ZERO : div100(mul(rate, sub(tbt, discount)));
  const final = sub(add(tbt, tax), discount);
  return { lines: lineTotals, totalBeforeTax: toFixed(tbt, 4), discount: toFixed(discount, 4), tax: toFixed(tax, 4), finalTotal: toFixed(final, 4) };
}
