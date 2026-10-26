import type { AuthUser } from '../common/types';
import { MODULES } from './manifest';
import { parseEnabledFeatures, visibleModules } from './visible-modules';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 1, businessId: 1, username: 'u', firstName: 'U', lastName: '', language: 'en',
  isAdmin: false, isSuperadmin: false, permissions: [], timeZone: 'UTC', ...over,
});

describe('visibleModules', () => {
  it('always shows the dashboard', () => {
    expect(visibleModules(user(), []).map((m) => m.id)).toContain('dashboard');
  });
  it('hides core modules whose feature toggle is off', () => {
    const ids = visibleModules(user({ isAdmin: true }), ['purchases']).map((m) => m.id);
    expect(ids).toContain('purchase');
    expect(ids).not.toContain('sell');
  });
  it('hides superadmin modules from a business admin but shows them to the Superadmin', () => {
    const features = ['pos_sale'];
    expect(visibleModules(user({ isAdmin: true }), features).map((m) => m.id)).not.toContain('superadmin');
    expect(visibleModules(user({ isSuperadmin: true }), features).map((m) => m.id)).toContain('superadmin');
  });
  it('shows a module when the user has one of its permissions', () => {
    expect(visibleModules(user({ permissions: ['product.view'] }), []).map((m) => m.id)).toContain('products');
  });
});

describe('manifest', () => {
  it('has unique ids', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseEnabledFeatures', () => {
  it('parses a JSON array and tolerates junk', () => {
    expect(parseEnabledFeatures('["expenses","account"]')).toEqual(['expenses', 'account']);
    expect(parseEnabledFeatures('not json')).toEqual([]);
    expect(parseEnabledFeatures(null)).toEqual([]);
  });
});
