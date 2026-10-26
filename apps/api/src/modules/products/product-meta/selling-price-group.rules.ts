import { BadRequestException } from '@nestjs/common';

export interface PriceGroupInput {
  name: string;
  description?: string | null;
}

/** Spatie permission that lets a role use (see / sell at) one selling price group. */
export function priceGroupPermissionName(groupId: number): string {
  return `selling_price_group.${groupId}`;
}

/** Trims the name (required) and turns a blank description into null. */
export function normalizePriceGroup(input: PriceGroupInput): { name: string; description: string | null } {
  const name = (input.name ?? '').trim();
  if (!name) throw new BadRequestException('Name is required');
  const description = (input.description ?? '').trim();
  return { name, description: description || null };
}

/** Activate / deactivate flips the flag (Laravel: is_active == 1 ? 0 : 1). */
export function toggledActive(isActive: boolean): boolean {
  return !isActive;
}

/**
 * The groups a user may pick in a dropdown: active ones the user holds the group permission for
 * (Laravel SellingPriceGroup::forDropdown). `canUse` is the permission check.
 */
export function usableGroups<T extends { id: number; is_active: boolean }>(groups: T[], canUse: (permission: string) => boolean): T[] {
  return groups.filter((g) => g.is_active && canUse(priceGroupPermissionName(g.id)));
}
