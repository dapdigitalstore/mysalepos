/**
 * Date helpers for the sale screens. The API stores real instants; the screens show and edit the business time zone
 * (`settings.business.timeZone`), which may differ from the browser's.
 */

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(date: Date, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const get = (type: string): number => Number(f.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `YYYY-MM-DDTHH:mm` (the value of <input type="datetime-local">) for an instant, as seen in `timeZone`. */
export function instantToLocalInput(iso: string | Date, timeZone: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = partsIn(d, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant (ISO text) that shows as `YYYY-MM-DDTHH:mm` in `timeZone`. Returns null for unusable input. */
export function localInputToInstant(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
  // two passes cope with a zone change (daylight saving) between the guess and the result
  let guess = naive - offsetAt(new Date(naive), timeZone);
  guess = naive - offsetAt(new Date(guess), timeZone);
  const out = new Date(guess);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** Display text for a list: `2026-10-25 18:30` in the business time zone and the user's locale. */
export function formatInstant(iso: string, timeZone: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'si' ? 'si-LK' : 'en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
