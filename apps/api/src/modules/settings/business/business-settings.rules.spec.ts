import { stopSellingBeforeFor, validateEnabledModules, validateRefPrefixes } from './business-settings.rules';

describe('validateEnabledModules', () => {
  it('accepts known features', () => {
    expect(validateEnabledModules(['purchases', 'pos_sale'])).toEqual(['purchases', 'pos_sale']);
  });
  it('rejects unknown features', () => {
    expect(() => validateEnabledModules(['purchases', 'nope'])).toThrow('nope');
  });
});

describe('validateRefPrefixes', () => {
  it('stores trimmed prefixes and nulls empty ones', () => {
    expect(JSON.parse(validateRefPrefixes({ purchase: ' PO ', sell_return: '' }))).toEqual({ purchase: 'PO', sell_return: null });
  });
  it('rejects unknown document types', () => {
    expect(() => validateRefPrefixes({ bogus: 'X' })).toThrow();
  });
  it('rejects overly long prefixes', () => {
    expect(() => validateRefPrefixes({ purchase: 'ABCDEFGHIJK' })).toThrow();
  });
});

describe('stopSellingBeforeFor', () => {
  it('clears the value when products keep selling after expiry', () => {
    expect(stopSellingBeforeFor('keep_selling', 5)).toBe(0);
  });
  it('keeps the value otherwise and ignores missing values', () => {
    expect(stopSellingBeforeFor('stop_selling', 5)).toBe(5);
    expect(stopSellingBeforeFor('stop_selling', undefined)).toBeUndefined();
  });
});
