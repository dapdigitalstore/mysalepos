import { permittedLocationIds } from './location-access';

const base = { isAdmin: false, isSuperadmin: false, permissions: [] as string[] };

describe('permittedLocationIds', () => {
  it('gives Admin and Superadmin every location', () => {
    expect(permittedLocationIds({ ...base, isAdmin: true })).toBe('all');
    expect(permittedLocationIds({ ...base, isSuperadmin: true })).toBe('all');
  });
  it('gives access_all_locations every location', () => {
    expect(permittedLocationIds({ ...base, permissions: ['access_all_locations'] })).toBe('all');
  });
  it('collects location.<id> permissions', () => {
    expect(permittedLocationIds({ ...base, permissions: ['location.3', 'product.view', 'location.12'] })).toEqual([3, 12]);
  });
  it('gives nothing without grants', () => {
    expect(permittedLocationIds(base)).toEqual([]);
  });
});
