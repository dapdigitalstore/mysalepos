import { can } from './can';

const base = { isAdmin: false, isSuperadmin: false, permissions: ['product.view'] };

describe('can()', () => {
  it('allows an explicitly granted permission', () => {
    expect(can(base, 'product.view')).toBe(true);
  });
  it('denies a permission the user does not hold', () => {
    expect(can(base, 'product.create')).toBe(false);
  });
  it('lets the business Admin do everything except superadmin', () => {
    const admin = { ...base, isAdmin: true, permissions: [] };
    expect(can(admin, 'sell.create')).toBe(true);
    expect(can(admin, 'superadmin')).toBe(false);
  });
  it('lets the Superadmin do everything', () => {
    expect(can({ ...base, isSuperadmin: true, permissions: [] }, 'superadmin')).toBe(true);
  });
});
