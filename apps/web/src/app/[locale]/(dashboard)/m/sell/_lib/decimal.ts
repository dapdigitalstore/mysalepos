/**
 * Exact decimal arithmetic for the live sale totals (BigInt, never floating point). Rounding is "half away from zero",
 * which is what the API uses (Prisma.Decimal ROUND_HALF_UP). Display only: the server recomputes every total.
 */
export interface Dec {
  /** value = n / 10^s */
  n: bigint;
  s: number;
}

const TEN = 10n;
const pow10 = (e: number): bigint => TEN ** BigInt(e);

export const ZERO: Dec = { n: 0n, s: 0 };
export const ONE: Dec = { n: 1n, s: 0 };
export const HUNDRED: Dec = { n: 100n, s: 0 };

/** Parses "12.50" / "12" / "-3.1" / ".5" (thousand commas are ignored). Returns null for anything else. */
export function parseDec(input: string | number | null | undefined): Dec | null {
  if (input === null || input === undefined) return null;
  const t = String(input).trim().replace(/,/g, '');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2] || '0'}${frac}`);
  return { n: m[1] ? -n : n, s: frac.length };
}

/** Like parseDec but anything unparsable (empty, text) is zero. */
export const dec = (input: string | number | null | undefined): Dec => parseDec(input) ?? ZERO;

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
export const isNeg = (a: Dec): boolean => a.n < 0n;
export const isZero = (a: Dec): boolean => a.n === 0n;
export const isPos = (a: Dec): boolean => a.n > 0n;
export const max = (a: Dec, b: Dec): Dec => (cmp(a, b) >= 0 ? a : b);
export const min = (a: Dec, b: Dec): Dec => (cmp(a, b) <= 0 ? a : b);
export const sum = (items: Dec[]): Dec => items.reduce(add, ZERO);

/** a / 100 (exact: only moves the decimal point). */
export const div100 = (a: Dec): Dec => ({ n: a.n, s: a.s + 2 });

/** True when the value has no fractional part. */
export function isWhole(a: Dec): boolean {
  return a.n % pow10(a.s) === 0n;
}

/** Number of decimals actually needed (trailing zeros ignored). */
export function decimalsOf(a: Dec): number {
  let n = a.n < 0n ? -a.n : a.n;
  let s = a.s;
  while (s > 0 && n % TEN === 0n) {
    n /= TEN;
    s -= 1;
  }
  return s;
}

/** Rounds half away from zero to `places` decimals. */
export function round(a: Dec, places: number): Dec {
  if (a.s <= places) return { n: a.n * pow10(places - a.s), s: places };
  const f = pow10(a.s - places);
  const neg = a.n < 0n;
  const abs = neg ? -a.n : a.n;
  let q = abs / f;
  if ((abs % f) * 2n >= f) q += 1n;
  return { n: neg ? -q : q, s: places };
}

/** a * b / c rounded half away from zero to `places` decimals (c must not be zero). */
export function mulDiv(a: Dec, b: Dec, c: Dec, places: number): Dec {
  if (isZero(c)) return ZERO;
  // (a.n/10^a.s) * (b.n/10^b.s) / (c.n/10^c.s) = (a.n*b.n*10^c.s) / (c.n*10^(a.s+b.s)); scaled by 10^places
  let num = a.n * b.n * pow10(c.s + places);
  let den = c.n * pow10(a.s + b.s);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const neg = num < 0n;
  const abs = neg ? -num : num;
  let q = abs / den;
  if ((abs % den) * 2n >= den) q += 1n;
  return { n: neg ? -q : q, s: places };
}

/** Rounds to the nearest multiple of `multiple` (e.g. 0.05, 1, 5), halves away from zero. A zero multiple returns `a`. */
export function toNearest(a: Dec, multiple: Dec): Dec {
  if (!isPos(multiple)) return a;
  const [x, m, s] = align(a, multiple);
  const neg = x < 0n;
  const abs = neg ? -x : x;
  let q = abs / m;
  if ((abs % m) * 2n >= m) q += 1n;
  return { n: (neg ? -q : q) * m, s };
}

/** "1234.50" text with exactly `places` decimals. */
export function toFixed(a: Dec, places = 2): string {
  const r = round(a, places);
  const neg = r.n < 0n;
  const digits = (neg ? -r.n : r.n).toString().padStart(places + 1, '0');
  const int = digits.slice(0, digits.length - places);
  const frac = digits.slice(digits.length - places);
  return `${neg ? '-' : ''}${int}${places > 0 ? `.${frac}` : ''}`;
}

/** Plain text without trailing zeros ("12.5", "3"), at most `maxPlaces` decimals; safe to send to the API. */
export function toText(a: Dec, maxPlaces = 4): string {
  const t = toFixed(a, maxPlaces);
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
}
