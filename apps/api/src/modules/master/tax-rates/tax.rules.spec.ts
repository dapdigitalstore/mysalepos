import { assertValidGroup, groupTaxAmount } from './tax.rules';

describe('groupTaxAmount', () => {
  it('sums sub-taxes without floating point drift', () => {
    expect(groupTaxAmount([0.1, 0.2])).toBe(0.3);
    expect(groupTaxAmount([7.5, 2.5, 5])).toBe(15);
  });
  it('is zero for no taxes', () => {
    expect(groupTaxAmount([])).toBe(0);
  });
});

describe('assertValidGroup', () => {
  it('requires at least one tax', () => {
    expect(() => assertValidGroup([], [])).toThrow();
  });
  it('rejects unknown tax ids', () => {
    expect(() => assertValidGroup([{ id: 1, is_tax_group: false }], [1, 2])).toThrow();
  });
  it('rejects nested groups', () => {
    expect(() => assertValidGroup([{ id: 1, is_tax_group: true }], [1])).toThrow();
  });
  it('accepts valid simple taxes', () => {
    expect(() => assertValidGroup([{ id: 1, is_tax_group: false }, { id: 2, is_tax_group: false }], [1, 2])).not.toThrow();
  });
});
