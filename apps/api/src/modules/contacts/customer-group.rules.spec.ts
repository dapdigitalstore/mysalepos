import { resolveCustomerGroupPricing } from './customer-group.rules';

describe('resolveCustomerGroupPricing', () => {
  it('keeps a percentage and clears the price group', () => {
    expect(resolveCustomerGroupPricing({ priceCalculationType: 'percentage', amount: 5, sellingPriceGroupId: 3 })).toEqual({
      price_calculation_type: 'percentage',
      amount: 5,
      selling_price_group_id: null,
    });
  });
  it('treats an empty percentage as zero (like Laravel)', () => {
    expect(resolveCustomerGroupPricing({ priceCalculationType: 'percentage' }).amount).toBe(0);
    expect(resolveCustomerGroupPricing({ priceCalculationType: 'percentage', amount: null }).amount).toBe(0);
  });
  it('allows a negative percentage (surcharge/discount) within -100..100', () => {
    expect(resolveCustomerGroupPricing({ priceCalculationType: 'percentage', amount: -10 }).amount).toBe(-10);
    expect(() => resolveCustomerGroupPricing({ priceCalculationType: 'percentage', amount: 100.5 })).toThrow();
    expect(() => resolveCustomerGroupPricing({ priceCalculationType: 'percentage', amount: -101 })).toThrow();
  });
  it('requires a selling price group for that type and zeroes the percentage', () => {
    expect(() => resolveCustomerGroupPricing({ priceCalculationType: 'selling_price_group', amount: 5 })).toThrow('selling price group');
    expect(resolveCustomerGroupPricing({ priceCalculationType: 'selling_price_group', amount: 5, sellingPriceGroupId: 2 })).toEqual({
      price_calculation_type: 'selling_price_group',
      amount: 0,
      selling_price_group_id: 2,
    });
  });
});
