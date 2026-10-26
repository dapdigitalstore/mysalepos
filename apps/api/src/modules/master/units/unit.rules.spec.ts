import { resolveBaseUnit } from './unit.rules';

describe('resolveBaseUnit', () => {
  it('returns nulls for a base unit', () => {
    expect(resolveBaseUnit({})).toEqual({ base_unit_id: null, base_unit_multiplier: null });
  });
  it('keeps a valid sub-unit definition', () => {
    expect(resolveBaseUnit({ baseUnitId: 4, baseUnitMultiplier: 12 })).toEqual({ base_unit_id: 4, base_unit_multiplier: 12 });
  });
  it('rejects a half-defined sub-unit', () => {
    expect(() => resolveBaseUnit({ baseUnitId: 4 })).toThrow();
    expect(() => resolveBaseUnit({ baseUnitMultiplier: 3 })).toThrow();
  });
  it('rejects a zero or negative multiplier', () => {
    expect(() => resolveBaseUnit({ baseUnitId: 4, baseUnitMultiplier: 0 })).toThrow();
    expect(() => resolveBaseUnit({ baseUnitId: 4, baseUnitMultiplier: -2 })).toThrow();
  });
  it('rejects a unit that is its own base', () => {
    expect(() => resolveBaseUnit({ baseUnitId: 7, baseUnitMultiplier: 2 }, 7)).toThrow();
  });
});
