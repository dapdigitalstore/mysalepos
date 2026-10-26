import {
  adminRoleName,
  assertGrantable,
  assertRoleDeletable,
  assertRoleEditable,
  assertSingleChoice,
  cleanRoleName,
  diffPermissionSets,
  displayRoleName,
  isAdminRole,
  isRoleLocked,
  mergeRolePermissions,
  storedRoleName,
  uniqueNames,
} from './role.rules';
import { buildCatalog, grantablePermissionNames, radioGroupsByPermission, visiblePermissionNames, type CatalogContext } from './permission-catalog';

const ctx = (over: Partial<CatalogContext> = {}): CatalogContext => ({
  enabledModules: ['purchases', 'add_sale', 'pos_sale', 'stock_adjustment', 'expenses'],
  commonSettings: {},
  posSettings: {},
  sellingPriceGroups: [],
  ...over,
});

describe('role names', () => {
  it('suffixes the business id when storing', () => {
    expect(storedRoleName('  Supervisor ', 7)).toBe('Supervisor#7');
  });
  it('removes the suffix for display', () => {
    expect(displayRoleName('Supervisor#7', 7)).toBe('Supervisor');
    expect(displayRoleName('Cashier#12', 12)).toBe('Cashier');
  });
  it('shows only the part before # when the suffix belongs to another business', () => {
    expect(displayRoleName('Supervisor#9', 7)).toBe('Supervisor');
  });
  it('rejects empty, too long and # names', () => {
    expect(() => cleanRoleName('   ')).toThrow();
    expect(() => cleanRoleName('x'.repeat(81))).toThrow();
    expect(() => cleanRoleName('Sales#1')).toThrow();
  });
  it('recognises the admin role of the business only', () => {
    expect(adminRoleName(3)).toBe('Admin#3');
    expect(isAdminRole('Admin#3', 3)).toBe(true);
    expect(isAdminRole('Admin#4', 3)).toBe(false);
    expect(isAdminRole('Cashier#3', 3)).toBe(false);
  });
});

describe('default roles', () => {
  it('locks the Admin role', () => {
    const admin = { name: 'Admin#1', is_default: true };
    expect(isRoleLocked(admin, 1)).toBe(true);
    expect(() => assertRoleEditable(admin, 1)).toThrow();
    expect(() => assertRoleDeletable(admin, 1, 0)).toThrow();
  });
  it('keeps the default Cashier role editable like Laravel', () => {
    expect(isRoleLocked({ name: 'Cashier#1', is_default: true }, 1)).toBe(false);
  });
  it('allows custom roles', () => {
    const custom = { name: 'Clerk#1', is_default: false };
    expect(() => assertRoleEditable(custom, 1)).not.toThrow();
    expect(() => assertRoleDeletable(custom, 1, 0)).not.toThrow();
  });
  it('refuses to delete a role that still has users', () => {
    expect(() => assertRoleDeletable({ name: 'Clerk#1', is_default: false }, 1, 2)).toThrow(/2 users/);
  });
});

describe('permission lists', () => {
  it('removes blanks and duplicates', () => {
    expect(uniqueNames(['a', ' a ', '', 'b', 'a'])).toEqual(['a', 'b']);
    expect(uniqueNames(undefined)).toEqual([]);
  });
  it('rejects names outside the catalog', () => {
    const ok = grantablePermissionNames(ctx());
    expect(() => assertGrantable(['user.view', 'sell.create'], ok)).not.toThrow();
    expect(() => assertGrantable(['user.view', 'superadmin'], ok)).toThrow(/superadmin/);
    expect(() => assertGrantable(['access_all_locations'], ok)).toThrow();
  });
  it('accepts selling price group permissions of this business only', () => {
    const ok = grantablePermissionNames(ctx({ sellingPriceGroups: [{ id: 4, name: 'Wholesale' }] }));
    expect(() => assertGrantable(['selling_price_group.4'], ok)).not.toThrow();
    expect(() => assertGrantable(['selling_price_group.5'], ok)).toThrow();
  });
  it('allows one choice per radio group', () => {
    const radios = radioGroupsByPermission();
    expect(() => assertSingleChoice(['supplier.view', 'supplier.create'], radios)).not.toThrow();
    expect(() => assertSingleChoice(['supplier.view', 'supplier.view_own'], radios)).toThrow();
    expect(() => assertSingleChoice(['supplier.view', 'customer.view'], radios)).not.toThrow();
    expect(() => assertSingleChoice(['supplier.view', 'supplier.view'], radios)).not.toThrow();
  });
});

describe('diffPermissionSets', () => {
  it('lists what to add and what to remove', () => {
    expect(diffPermissionSets(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ add: ['d'], remove: ['a'] });
  });
  it('is empty when nothing changed', () => {
    expect(diffPermissionSets(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [] });
  });
  it('clears everything when the new set is empty', () => {
    expect(diffPermissionSets(['a', 'b'], [])).toEqual({ add: [], remove: ['a', 'b'] });
  });
});

describe('mergeRolePermissions', () => {
  it('keeps permissions the editor could not show', () => {
    const visible = new Set(['user.view', 'user.create']);
    const merged = mergeRolePermissions(['user.view'], ['user.view', 'user.create', 'woocommerce.sync_orders', 'expense.access'], visible);
    expect(merged).toEqual(['user.view', 'woocommerce.sync_orders', 'expense.access']);
  });
  it('lets people untick visible permissions', () => {
    expect(mergeRolePermissions([], ['user.view'], new Set(['user.view']))).toEqual([]);
  });
});

describe('catalog', () => {
  const groupKeys = (c: CatalogContext) => buildCatalog(c).map((g) => g.key);
  const names = (c: CatalogContext) => [...visiblePermissionNames(c)];

  it('hides modules the business has not enabled', () => {
    const k = groupKeys(ctx({ enabledModules: ['pos_sale'] }));
    expect(k).not.toContain('purchase');
    expect(k).not.toContain('expense');
    expect(k).not.toContain('bookings');
    expect(k).not.toContain('restaurant');
    expect(k).toContain('pos_sale');
  });
  it('shows the purchase group when only stock adjustment is on', () => {
    expect(groupKeys(ctx({ enabledModules: ['stock_adjustment'] }))).toContain('purchase');
  });
  it('shows requisition / order / sales order only when their setting is on', () => {
    expect(groupKeys(ctx())).not.toContain('purchase_order');
    const k = groupKeys(ctx({ commonSettings: { enable_purchase_order: '1' }, posSettings: { enable_sales_order: 1 } }));
    expect(k).toContain('purchase_order');
    expect(k).toContain('sales_order');
    expect(k).not.toContain('purchase_requisition');
  });
  it('hides individual items when their module is off', () => {
    expect(names(ctx({ enabledModules: ['add_sale'] }))).not.toContain('sell.create');
    expect(names(ctx({ enabledModules: ['pos_sale'] }))).not.toContain('direct_sell.access');
    expect(names(ctx({ enabledModules: ['pos_sale', 'add_sale'] }))).toEqual(expect.arrayContaining(['sell.create', 'direct_sell.access']));
  });
  it('lists selling price groups before the restaurant section, with the default access ticked', () => {
    const groups = buildCatalog(ctx({ enabledModules: ['tables'], sellingPriceGroups: [{ id: 2, name: 'VIP' }] }));
    const keys = groups.map((g) => g.key);
    expect(keys.indexOf('selling_price_groups')).toBe(keys.indexOf('restaurant') - 1);
    const spg = groups.find((g) => g.key === 'selling_price_groups');
    expect(spg?.items).toEqual([
      { name: 'access_default_selling_price', label: 'Default selling price', default: true },
      { name: 'selling_price_group.2', label: 'VIP', dynamic: true },
    ]);
  });
  it('never exposes location or superadmin permissions', () => {
    const all = grantablePermissionNames(ctx());
    expect(all.has('access_all_locations')).toBe(false);
    expect(all.has('superadmin')).toBe(false);
    expect([...all].some((n) => n.startsWith('location.'))).toBe(false);
  });
  it('has no duplicate permission names', () => {
    const list = buildCatalog(ctx({ enabledModules: ['purchases', 'stock_adjustment', 'add_sale', 'pos_sale', 'expenses', 'booking', 'tables', 'types_of_service'] }))
      .flatMap((g) => g.items.map((i) => i.name));
    expect(new Set(list).size).toBe(list.length);
  });
});
