import { assertWarrantyDeletable, normalizeWarranty, warrantyEndDate, warrantyLabel } from './warranty.rules';

describe('normalizeWarranty', () => {
  it('trims and maps to columns', () => {
    expect(normalizeWarranty({ name: ' 1 Year ', description: ' ', duration: 12, durationType: 'months' })).toEqual({
      name: '1 Year',
      description: null,
      duration: 12,
      duration_type: 'months',
    });
    expect(normalizeWarranty({ name: 'A', description: 'Covers parts', duration: 2, durationType: 'years' }).description).toBe('Covers parts');
  });
  it('rejects a blank name', () => {
    expect(() => normalizeWarranty({ name: '  ', duration: 1, durationType: 'days' })).toThrow();
  });
  it('rejects zero, negative and fractional durations', () => {
    expect(() => normalizeWarranty({ name: 'A', duration: 0, durationType: 'days' })).toThrow();
    expect(() => normalizeWarranty({ name: 'A', duration: -3, durationType: 'days' })).toThrow();
    expect(() => normalizeWarranty({ name: 'A', duration: 1.5, durationType: 'days' })).toThrow();
  });
  it('rejects an unknown duration type', () => {
    expect(() => normalizeWarranty({ name: 'A', duration: 1, durationType: 'weeks' })).toThrow();
  });
});

describe('warrantyLabel', () => {
  it('formats the dropdown label', () => {
    expect(warrantyLabel('Phone', 12, 'months')).toBe('Phone (12 months)');
    expect(warrantyLabel('Phone', 1, 'years')).toBe('Phone (1 year)');
  });
});

describe('warrantyEndDate', () => {
  const start = new Date('2026-01-31T10:00:00Z');
  it('adds days, months and years', () => {
    expect(warrantyEndDate(start, 10, 'days').toISOString()).toBe('2026-02-10T10:00:00.000Z');
    expect(warrantyEndDate(new Date('2026-03-15T00:00:00Z'), 2, 'months').toISOString()).toBe('2026-05-15T00:00:00.000Z');
    expect(warrantyEndDate(start, 1, 'years').toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });
  it('overflows month ends like Carbon', () => {
    expect(warrantyEndDate(start, 1, 'months').toISOString()).toBe('2026-03-03T10:00:00.000Z');
  });
  it('does not mutate the start date', () => {
    warrantyEndDate(start, 5, 'days');
    expect(start.toISOString()).toBe('2026-01-31T10:00:00.000Z');
  });
});

describe('assertWarrantyDeletable', () => {
  it('blocks a warranty in use', () => {
    expect(() => assertWarrantyDeletable({ products: 0, sellLines: 0 })).not.toThrow();
    expect(() => assertWarrantyDeletable({ products: 1, sellLines: 0 })).toThrow();
    expect(() => assertWarrantyDeletable({ products: 0, sellLines: 4 })).toThrow();
  });
});
