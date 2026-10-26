import { Prisma } from '@prisma/client';
import { instantToWallClock, mapDates, startOfDayInstant, startOfMonthInstant, wallClockToInstant, zoneOffsetMs } from './time';

describe('time zone conversion', () => {
  it('knows the offsets of Asia/Colombo and Asia/Kolkata (+5:30) and New York (DST aware)', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 5, 1), 'Asia/Colombo')).toBe(5.5 * 3600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 5, 1), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 1), 'America/New_York')).toBe(-4 * 3600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 0, 1), 'America/New_York')).toBe(-5 * 3600_000);
  });

  it('stores an instant as the local wall clock and reads it back', () => {
    const instant = new Date('2026-10-26T18:30:00.000Z'); // 2026-10-27 00:00 in Colombo
    const wall = instantToWallClock(instant, 'Asia/Colombo');
    expect(wall.toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect(wallClockToInstant(wall, 'Asia/Colombo').toISOString()).toBe(instant.toISOString());
  });

  it('round-trips across a DST change', () => {
    for (const iso of ['2026-03-08T06:59:00Z', '2026-03-08T07:30:00Z', '2026-11-01T05:30:00Z', '2026-11-01T07:30:00Z']) {
      const i = new Date(iso);
      expect(wallClockToInstant(instantToWallClock(i, 'America/New_York'), 'America/New_York').toISOString()).toBe(i.toISOString());
    }
  });

  it('keeps milliseconds', () => {
    const i = new Date('2026-01-01T10:00:00.123Z');
    expect(instantToWallClock(i, 'Asia/Colombo').getUTCMilliseconds()).toBe(123);
  });

  it('finds the start of the month and day in the business zone', () => {
    const now = new Date('2026-10-31T20:00:00Z'); // already 2026-11-01 01:30 in Colombo
    expect(startOfMonthInstant('Asia/Colombo', now).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(startOfDayInstant('Asia/Colombo', now).toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });
});

describe('mapDates', () => {
  const plus1 = (d: Date) => new Date(d.getTime() + 1000);
  const skip = new Set(['dob']);

  it('maps nested dates but leaves date-only keys, decimals and primitives alone', () => {
    const dec = new Prisma.Decimal('12.5');
    const input = { a: new Date(0), dob: new Date(0), n: 5, amount: dec, list: [{ b: new Date(0) }], nul: null };
    const out = mapDates(input, plus1, skip);
    expect(out.a.getTime()).toBe(1000);
    expect(out.dob.getTime()).toBe(0);
    expect(out.list[0].b.getTime()).toBe(1000);
    expect(out.amount).toBe(dec);
    expect(out.nul).toBeNull();
  });
});
