import { BadRequestException } from '@nestjs/common';

export interface BaseUnitInput {
  baseUnitId?: number | null;
  baseUnitMultiplier?: number | null;
}

/**
 * A unit is either a base unit (no parent) or a sub-unit defined as `multiplier` x its base unit
 * (e.g. Dozen = 12 x Piece). Returns the columns to store; throws when the definition is not valid.
 */
export function resolveBaseUnit(input: BaseUnitInput, selfId?: number): { base_unit_id: number | null; base_unit_multiplier: number | null } {
  const { baseUnitId, baseUnitMultiplier } = input;
  if (baseUnitId == null && baseUnitMultiplier == null) return { base_unit_id: null, base_unit_multiplier: null };
  if (baseUnitId == null || baseUnitMultiplier == null) {
    throw new BadRequestException('Base unit and multiplier must be given together');
  }
  if (!(baseUnitMultiplier > 0)) throw new BadRequestException('Multiplier must be greater than zero');
  if (selfId !== undefined && baseUnitId === selfId) throw new BadRequestException('A unit cannot be its own base unit');
  return { base_unit_id: baseUnitId, base_unit_multiplier: baseUnitMultiplier };
}
