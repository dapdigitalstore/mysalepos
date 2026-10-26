import { orderBy, paginated, skipTake } from './pagination';

describe('pagination helpers', () => {
  it('computes skip/take from page and perPage', () => {
    expect(skipTake({ page: 3, perPage: 10 })).toEqual({ skip: 20, take: 10 });
  });
  it('builds meta with at least one page', () => {
    expect(paginated([], 0, { page: 1, perPage: 25 }).meta).toEqual({ page: 1, perPage: 25, total: 0, totalPages: 1 });
    expect(paginated([1], 51, { page: 1, perPage: 25 }).meta.totalPages).toBe(3);
  });
  it('only sorts on whitelisted columns', () => {
    expect(orderBy({ sortBy: 'name', sortDir: 'desc' }, ['name', 'id'], 'id')).toEqual({ name: 'desc' });
    expect(orderBy({ sortBy: 'password', sortDir: 'desc' }, ['name', 'id'], 'id')).toEqual({ id: 'desc' });
    expect(orderBy({ sortDir: 'asc' }, ['name'], 'name')).toEqual({ name: 'asc' });
  });
});
