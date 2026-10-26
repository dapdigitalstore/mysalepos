import { normalizePriceGroup, priceGroupPermissionName, toggledActive, usableGroups } from './selling-price-group.rules';

describe('priceGroupPermissionName', () => {
  it('uses the Spatie name Laravel creates', () => {
    expect(priceGroupPermissionName(7)).toBe('selling_price_group.7');
  });
});

describe('normalizePriceGroup', () => {
  it('trims and nulls a blank description', () => {
    expect(normalizePriceGroup({ name: ' Wholesale ', description: '  ' })).toEqual({ name: 'Wholesale', description: null });
    expect(normalizePriceGroup({ name: 'VIP', description: ' Best customers ' })).toEqual({ name: 'VIP', description: 'Best customers' });
    expect(normalizePriceGroup({ name: 'VIP' }).description).toBeNull();
  });
  it('rejects a blank name', () => {
    expect(() => normalizePriceGroup({ name: '   ' })).toThrow();
  });
});

describe('toggledActive', () => {
  it('flips the flag', () => {
    expect(toggledActive(true)).toBe(false);
    expect(toggledActive(false)).toBe(true);
  });
});

describe('usableGroups', () => {
  const groups = [
    { id: 1, is_active: true },
    { id: 2, is_active: false },
    { id: 3, is_active: true },
  ];
  it('keeps active groups the user holds the permission for', () => {
    const held = new Set(['selling_price_group.1', 'selling_price_group.2']);
    expect(usableGroups(groups, (p) => held.has(p)).map((g) => g.id)).toEqual([1]);
  });
  it('returns everything active for a user who can do everything', () => {
    expect(usableGroups(groups, () => true).map((g) => g.id)).toEqual([1, 3]);
  });
});
