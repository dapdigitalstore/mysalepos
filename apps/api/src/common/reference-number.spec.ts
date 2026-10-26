import { formatReferenceNumber, prefixFor } from './reference-number';

describe('formatReferenceNumber', () => {
  it('numbers contacts without the year', () => {
    expect(formatReferenceNumber('contacts', 3, 'CO', 2026)).toBe('CO0003');
    expect(formatReferenceNumber('business_location', 1, 'BL', 2026)).toBe('BL0001');
  });
  it('adds the year for documents', () => {
    expect(formatReferenceNumber('purchase', 12, 'PO', 2026)).toBe('PO2026/0012');
    expect(formatReferenceNumber('sell_payment', 7, null, 2026)).toBe('2026/0007');
  });
  it('does not truncate counts above 9999', () => {
    expect(formatReferenceNumber('contacts', 12345, '', 2026)).toBe('12345');
  });
});

describe('prefixFor', () => {
  it('reads a prefix from the stored JSON', () => {
    expect(prefixFor('{"contacts":"CO","purchase":null}', 'contacts')).toBe('CO');
    expect(prefixFor('{"contacts":"CO","purchase":null}', 'purchase')).toBe('');
  });
  it('tolerates empty or invalid JSON', () => {
    expect(prefixFor(null, 'contacts')).toBe('');
    expect(prefixFor('oops', 'contacts')).toBe('');
  });
});
