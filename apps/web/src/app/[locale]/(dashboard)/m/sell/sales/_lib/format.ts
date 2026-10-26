/**
 * Date, quantity and decimal helpers of the sales screens.
 * Every date is shown in the business time zone (`/auth/me` -> business.time_zone), never in the browser's.
 */

export const FALLBACK_TIME_ZONE = 'Asia/Colombo';

/** next-intl locale -> BCP 47 tag used for dates (Sinhala as spoken in Sri Lanka). */
export function dateLocale(locale: string): string {
  return locale === 'si' ? 'si-LK' : 'en-GB';
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2026-10-25T12:57:15.000Z` -> "25/10/2026, 18:27" in the business time zone. Empty for null. */
export function formatDateTime(value: string | null | undefined, timeZone: string, locale: string): string {
  const d = validDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function formatDate(value: string | null | undefined, timeZone: string, locale: string): string {
  const d = validDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(dateLocale(locale), { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Quantities come as decimal strings with up to 4 decimals: drop trailing zeros. */
export function formatQuantity(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);
}

/** Percent such as "10.0000" -> "10". */
export function formatPercent(value: string | number): string {
  return formatQuantity(value);
}

// ---------------------------------------------------------------------------------------------- calendar days

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year ?? 1970, month: out.month ?? 1, day: out.day ?? 1, hour: out.hour ?? 0, minute: out.minute ?? 0, second: out.second ?? 0 };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Today's calendar day (YYYY-MM-DD) in the business time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function dayToUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function utcToDay(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day: string, n: number): string {
  const d = dayToUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToDay(d);
}

export type RangeKey = 'all' | 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

/** Start and end day (both included) of a quick range, in the business time zone. Weeks start on Monday. */
export function rangeDays(key: RangeKey, timeZone: string, now: Date = new Date()): { startDate: string; endDate: string } {
  if (key === 'all' || key === 'custom') return { startDate: '', endDate: '' };
  const today = todayIn(timeZone, now);
  const t = dayToUtc(today);
  switch (key) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { startDate: y, endDate: y };
    }
    case 'thisWeek': {
      const offset = (t.getUTCDay() + 6) % 7; // Monday = 0
      const start = addDays(today, -offset);
      return { startDate: start, endDate: addDays(start, 6) };
    }
    case 'thisMonth': {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
      return { startDate: utcToDay(first), endDate: utcToDay(last) };
    }
    case 'lastMonth': {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return { startDate: utcToDay(first), endDate: utcToDay(last) };
    }
  }
}

// ---------------------------------------------------------------------------------------------- date-time inputs

/** Instant -> value of `<input type="datetime-local">` showing the wall clock of the business time zone. */
export function instantToInput(value: string | null | undefined, timeZone: string): string {
  const d = validDate(value);
  if (!d) return '';
  const p = zonedParts(d, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Value of `<input type="datetime-local">` read as business-time-zone wall clock -> real instant (ISO). */
export function inputToInstant(value: string, timeZone: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return undefined;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const offsetAt = (ms: number) => {
    const p = zonedParts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return new Date(guess).toISOString();
}

// ---------------------------------------------------------------------------------------------- decimals (no floats)

const SCALE = 4;

/** "1250.5" -> 12505000n (4 decimals). Null when the text is not a plain non-negative decimal number. */
export function toUnits(text: string): bigint | null {
  const s = text.trim();
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1] + (m[2] ?? '').padEnd(SCALE, '0'));
}

/** 12505000n -> "1250.50" (at least 2 decimals). */
export function fromUnits(units: bigint): string {
  const s = units.toString().padStart(SCALE + 1, '0');
  const int = s.slice(0, -SCALE);
  const frac = s.slice(-SCALE).replace(/0+$/, '').padEnd(2, '0');
  return `${int}.${frac}`;
}

/** Plain decimal string for a form field: "1072.5" -> "1072.50". */
export function toFieldValue(value: string | number): string {
  const u = toUnits(String(value));
  return u === null ? '' : fromUnits(u);
}
