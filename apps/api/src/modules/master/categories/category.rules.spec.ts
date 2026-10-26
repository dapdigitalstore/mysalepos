import { assertValidParent } from './category.rules';

describe('assertValidParent', () => {
  it('accepts a main category', () => {
    expect(() => assertValidParent({ parentId: 0, parentIsMain: true })).not.toThrow();
  });
  it('accepts a sub-category under a main category', () => {
    expect(() => assertValidParent({ selfId: 5, parentId: 2, parentIsMain: true })).not.toThrow();
  });
  it('rejects self as parent', () => {
    expect(() => assertValidParent({ selfId: 2, parentId: 2, parentIsMain: true })).toThrow();
  });
  it('rejects a third level', () => {
    expect(() => assertValidParent({ selfId: 5, parentId: 3, parentIsMain: false })).toThrow();
  });
  it('rejects turning a parent into a sub-category', () => {
    expect(() => assertValidParent({ selfId: 5, parentId: 2, parentIsMain: true, selfHasChildren: true })).toThrow();
  });
});
