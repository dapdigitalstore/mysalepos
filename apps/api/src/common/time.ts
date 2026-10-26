/**
 * Laravel stores DATETIME/TIMESTAMP columns as naive wall-clock values in the business time zone
 * (business.time_zone). Prisma reads those naive values as if they were UTC. These helpers convert
 * between a real instant and that "wall clock as UTC" representation so both apps agree.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset (local minus UTC) in ms of `tz` at the given instant. */
export function zoneOffsetMs(instantMs: number, tz: string): number {
  const parts = formatterFor(tz).formatToParts(new Date(instantMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Real instant -> the Date whose UTC fields show the wall clock in `tz` (what gets stored in the DB). */
export function instantToWallClock(instant: Date, tz: string): Date {
  if (tz === 'UTC') return instant;
  return new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), tz));
}

/** Date read from the DB (naive wall clock in `tz`, read as UTC) -> the real instant. */
export function wallClockToInstant(wall: Date, tz: string): Date {
  if (tz === 'UTC') return wall;
  const first = wall.getTime() - zoneOffsetMs(wall.getTime(), tz);
  return new Date(wall.getTime() - zoneOffsetMs(first, tz));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Instant of 00:00 on the first day of the month that contains `now` in `tz`. */
export function startOfMonthInstant(tz: string, now = new Date()): Date {
  const wall = instantToWallClock(now, tz);
  return wallClockToInstant(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1)), tz);
}

/** Instant of 00:00 of the day that contains `now` in `tz`. */
export function startOfDayInstant(tz: string, now = new Date()): Date {
  const wall = instantToWallClock(now, tz);
  return wallClockToInstant(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())), tz);
}

/**
 * Deep-maps every Date inside plain objects/arrays (query args and results). Keys listed in `skipKeys`
 * (date-only columns) are left alone so a date such as a birthday never shifts a day.
 */
export function mapDates<T>(value: T, fn: (d: Date) => Date, skipKeys: ReadonlySet<string>): T {
  if (value instanceof Date) return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapDates(v, fn, skipKeys)) as T;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = skipKeys.has(k) ? v : mapDates(v, fn, skipKeys);
    }
    return out as T;
  }
  return value;
}
