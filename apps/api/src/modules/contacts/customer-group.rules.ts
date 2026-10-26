import { BadRequestException } from '@nestjs/common';

export interface CustomerGroupInput {
  priceCalculationType: 'percentage' | 'selling_price_group';
  amount?: number | null;
  sellingPriceGroupId?: number | null;
}

/**
 * A customer group prices either by a percentage or by a selling price group (Laravel customer_group form).
 * Returns the columns to store: the unused one is cleared so stale values never leak into pricing.
 */
export function resolveCustomerGroupPricing(input: CustomerGroupInput): {
  price_calculation_type: string;
  amount: number;
  selling_price_group_id: number | null;
} {
  if (input.priceCalculationType === 'selling_price_group') {
    if (input.sellingPriceGroupId == null) throw new BadRequestException('Choose a selling price group');
    return { price_calculation_type: 'selling_price_group', amount: 0, selling_price_group_id: input.sellingPriceGroupId };
  }
  const amount = input.amount ?? 0;
  if (!Number.isFinite(amount) || amount < -100 || amount > 100) throw new BadRequestException('Percentage must be between -100 and 100');
  return { price_calculation_type: 'percentage', amount, selling_price_group_id: null };
}
