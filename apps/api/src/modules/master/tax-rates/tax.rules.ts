import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Amount of a tax group = sum of its sub-taxes. Decimal arithmetic so 0.1 + 0.2 never drifts. */
export function groupTaxAmount(subAmounts: number[]): number {
  return subAmounts.reduce((sum, a) => sum.add(new Prisma.Decimal(a)), new Prisma.Decimal(0)).toNumber();
}

/** A tax group must have at least one sub-tax, and sub-taxes cannot themselves be groups. */
export function assertValidGroup(subTaxes: { id: number; is_tax_group: boolean }[], requestedIds: number[]): void {
  if (requestedIds.length === 0) throw new BadRequestException('Select at least one tax for the group');
  if (new Set(requestedIds).size !== subTaxes.length) throw new BadRequestException('One or more selected taxes were not found');
  if (subTaxes.some((t) => t.is_tax_group)) throw new BadRequestException('A tax group cannot contain another group');
}
