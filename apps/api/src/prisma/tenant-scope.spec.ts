import { applyTenantScope } from './tenant-scope';

describe('applyTenantScope', () => {
  it('adds business_id to findMany filters and keeps existing ones', () => {
    expect(applyTenantScope('findMany', { where: { name: 'x' } }, 7)).toEqual({ where: { name: 'x', business_id: 7 } });
  });
  it('overrides a business_id supplied by the caller', () => {
    expect(applyTenantScope('findFirst', { where: { business_id: 99 } }, 7).where).toEqual({ business_id: 7 });
  });
  it('stamps business_id on create and createMany', () => {
    expect(applyTenantScope('create', { data: { name: 'a' } }, 7).data).toEqual({ name: 'a', business_id: 7 });
    expect(applyTenantScope('createMany', { data: [{ n: 1 }, { n: 2 }] }, 7).data).toEqual([
      { n: 1, business_id: 7 }, { n: 2, business_id: 7 },
    ]);
  });
  it('works when no args are given', () => {
    expect(applyTenantScope('count', undefined, 3)).toEqual({ where: { business_id: 3 } });
  });
});
