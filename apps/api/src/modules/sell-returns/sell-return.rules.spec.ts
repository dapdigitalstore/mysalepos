import { Prisma } from '@prisma/client';
import {
  applyMappingPlan,
  assertLocationPermitted,
  assertReturnableSale,
  assertTotalsSane,
  calculatePaymentStatus,
  calculateRewardPoints,
  computeReturnTotals,
  dayRange,
  discountFromStored,
  displayQuantity,
  groupTaxBreakdown,
  hasReturnedQuantity,
  netPaid,
  normalizeDiscount,
  planMappingChange,
  refundDue,
  resolveReturnQuantities,
  returnAccessScope,
  rewardAdjustmentForReturn,
  rewardExpired,
  saleVisibilityScope,
  stockChange,
  validateRefundPayment,
  type RewardSettings,
  type SaleLineFacts,
  type SellPurchaseMapping,
} from './sell-return.rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const canOf =
  (...perms: string[]) =>
  (p: string) =>
    perms.includes(p);

describe('permissions', () => {
  it('access_sell_return sees all returns, access_own_sell_return only its own, nothing else none', () => {
    expect(returnAccessScope(canOf('access_sell_return', 'access_own_sell_return'))).toBe('all');
    expect(returnAccessScope(canOf('access_own_sell_return'))).toBe('own');
    expect(returnAccessScope(canOf('sell.view'))).toBeNull();
  });
  it('view_own_sell_only restricts sales unless the user also has direct_sell.access', () => {
    expect(saleVisibilityScope(canOf('view_own_sell_only'))).toBe('own');
    expect(saleVisibilityScope(canOf('view_own_sell_only', 'direct_sell.access'))).toBe('all');
    expect(saleVisibilityScope(canOf())).toBe('all');
  });
  it('locations: all passes, a list restricts', () => {
    expect(() => assertLocationPermitted('all', 5)).not.toThrow();
    expect(() => assertLocationPermitted([1, 2], 2)).not.toThrow();
    expect(() => assertLocationPermitted([1, 2], 3)).toThrow();
    expect(() => assertLocationPermitted([1, 2], null)).toThrow();
  });
  it('only a final sale can be returned', () => {
    expect(() => assertReturnableSale({ type: 'sell', status: 'final' })).not.toThrow();
    expect(() => assertReturnableSale({ type: 'sell', status: 'draft' })).toThrow();
    expect(() => assertReturnableSale({ type: 'purchase', status: 'final' })).toThrow();
  });
});

describe('normalizeDiscount', () => {
  it('no type given = fixed (Laravel default), empty type = no discount', () => {
    expect(normalizeDiscount(undefined, undefined).type).toBe('fixed');
    expect(normalizeDiscount(undefined, undefined).amount.toString()).toBe('0');
    expect(normalizeDiscount('', 50).type).toBeNull();
    expect(normalizeDiscount('', 50).amount.toString()).toBe('0');
    expect(normalizeDiscount(null, 50).type).toBeNull();
  });
  it('accepts fixed and percentage', () => {
    expect(normalizeDiscount('percentage', 25).amount.toString()).toBe('25');
    expect(normalizeDiscount('fixed', '12.5').amount.toString()).toBe('12.5');
  });
  it('rejects negative, over 100 percent and unknown types', () => {
    expect(() => normalizeDiscount('fixed', -1)).toThrow();
    expect(() => normalizeDiscount('percentage', 100.01)).toThrow();
    expect(() => normalizeDiscount('percentage', 100)).not.toThrow();
    expect(() => normalizeDiscount('bogus', 1)).toThrow();
  });
});

describe('computeReturnTotals (calculateInvoiceTotal)', () => {
  const line = (q: Prisma.Decimal.Value, p: Prisma.Decimal.Value) => ({ quantity: D(q), unitPriceIncTax: D(p) });

  it('adds up quantity * price with no discount and no tax', () => {
    const t = computeReturnTotals([line(2, 700), line(1, 200)], normalizeDiscount('', 0), null);
    expect(t.totalBeforeTax.toString()).toBe('1600');
    expect(t.tax.toString()).toBe('0');
    expect(t.discount.toString()).toBe('0');
    expect(t.finalTotal.toString()).toBe('1600');
  });
  it('real sale 1025: 4400, 25% discount, 10% service charge = 3630', () => {
    const t = computeReturnTotals([line(1, 700), line(1, 200), line(1, 3500)], normalizeDiscount('percentage', 25), 10);
    expect(t.totalBeforeTax.toString()).toBe('4400');
    expect(t.discount.toString()).toBe('1100');
    expect(t.tax.toString()).toBe('330');
    expect(t.finalTotal.toString()).toBe('3630');
  });
  it('tax is charged on the discounted amount', () => {
    const t = computeReturnTotals([line(1, 1000)], normalizeDiscount('fixed', 200), 8);
    expect(t.tax.toString()).toBe('64');
    expect(t.finalTotal.toString()).toBe('864');
  });
  it('a partial quantity returns only that part', () => {
    const t = computeReturnTotals([line('2.5', 120)], normalizeDiscount('percentage', 10), 0);
    expect(t.totalBeforeTax.toString()).toBe('300');
    expect(t.finalTotal.toString()).toBe('270');
  });
  it('is exact in decimals (no float drift) and rounds once, half up, to 4 places', () => {
    const t = computeReturnTotals([line('3', '0.1')], normalizeDiscount('', 0), 0);
    expect(t.totalBeforeTax.toString()).toBe('0.3');
    const r = computeReturnTotals([line('1', '0.33333')], normalizeDiscount('', 0), 0);
    expect(r.totalBeforeTax.toString()).toBe('0.3333');
    const h = computeReturnTotals([line('1', '0.00005')], normalizeDiscount('', 0), 0);
    expect(h.totalBeforeTax.toString()).toBe('0.0001');
  });
  it('an empty return is zero', () => {
    const t = computeReturnTotals([line(0, 500)], normalizeDiscount('fixed', 0), 10);
    expect(t.finalTotal.toString()).toBe('0');
  });
  it('rejects a discount bigger than the returned value', () => {
    const t = computeReturnTotals([line(1, 100)], normalizeDiscount('fixed', 150), 0);
    expect(() => assertTotalsSane(t)).toThrow('discount');
    expect(() => assertTotalsSane(computeReturnTotals([line(1, 100)], normalizeDiscount('fixed', 100), 0))).not.toThrow();
  });
  it('recovers the applied discount from stored totals', () => {
    expect(discountFromStored('4400', '330', '3630').toString()).toBe('1100');
  });
});

describe('groupTaxBreakdown', () => {
  it('splits the tax amount in proportion to the sub tax rates', () => {
    const rows = groupTaxBreakdown(
      [
        { id: 1, name: 'VAT', amount: D(8) },
        { id: 2, name: 'NBT', amount: D(2) },
      ],
      '100',
    );
    expect(rows.map((r) => r.amount)).toEqual(['80', '20']);
  });
  it('gives zero when the rates sum to zero', () => {
    expect(groupTaxBreakdown([{ id: 1, name: 'x', amount: D(0) }], '50')[0].amount).toBe('0');
  });
});

describe('resolveReturnQuantities', () => {
  const lineA: SaleLineFacts = { id: 1, quantity: D(5), quantityReturned: D(0), unitPriceIncTax: D(100), multiplier: D(1), allowDecimal: false };
  const lineB: SaleLineFacts = { id: 2, quantity: D('2.5'), quantityReturned: D('1'), unitPriceIncTax: D(40), multiplier: D(1), allowDecimal: true };
  const dozen: SaleLineFacts = { id: 3, quantity: D(24), quantityReturned: D(0), unitPriceIncTax: D(10), multiplier: D(12), allowDecimal: false };

  it('returns one entry per sale line with the difference to what was returned before', () => {
    const r = resolveReturnQuantities([lineA, lineB], [
      { sellLineId: 1, quantity: 3 },
      { sellLineId: 2, quantity: '0.5' },
    ]);
    expect(r.map((x) => x.newQuantity.toString())).toEqual(['3', '0.5']);
    expect(r.map((x) => x.difference.toString())).toEqual(['3', '-0.5']);
  });
  it('treats lines missing from the request as 0 returned', () => {
    const r = resolveReturnQuantities([lineA, lineB], [{ sellLineId: 1, quantity: 1 }]);
    expect(r[1].newQuantity.toString()).toBe('0');
    expect(r[1].difference.toString()).toBe('-1');
  });
  it('refuses more than was sold, negatives, duplicates and unknown lines', () => {
    expect(() => resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: 6 }])).toThrow('more than the quantity sold');
    expect(() => resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: -1 }])).toThrow('negative');
    expect(() =>
      resolveReturnQuantities([lineA], [
        { sellLineId: 1, quantity: 1 },
        { sellLineId: 1, quantity: 1 },
      ]),
    ).toThrow('twice');
    expect(() => resolveReturnQuantities([lineA], [{ sellLineId: 9, quantity: 1 }])).toThrow('does not belong');
  });
  it('allows exactly the sold quantity', () => {
    expect(resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: 5 }])[0].newQuantity.toString()).toBe('5');
  });
  it('refuses decimals when the unit does not allow them, and more than 4 decimals', () => {
    expect(() => resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: '1.5' }])).toThrow('Decimal quantity');
    expect(() => resolveReturnQuantities([lineB], [{ sellLineId: 2, quantity: '0.00001' }])).toThrow('4 decimals');
  });
  it('converts a sub unit quantity to base units with the multiplier', () => {
    const r = resolveReturnQuantities([dozen], [{ sellLineId: 3, quantity: 1 }]);
    expect(r[0].newQuantity.toString()).toBe('12');
    expect(() => resolveReturnQuantities([dozen], [{ sellLineId: 3, quantity: 3 }])).toThrow('more than the quantity sold');
  });
  it('returning everything works even when the shown quantity was rounded to 4 decimals', () => {
    const odd: SaleLineFacts = { id: 4, quantity: D(1), quantityReturned: D(0), unitPriceIncTax: D(5), multiplier: D(12), allowDecimal: true };
    expect(displayQuantity(odd.quantity, odd.multiplier).toString()).toBe('0.0833');
    const r = resolveReturnQuantities([odd], [{ sellLineId: 4, quantity: '0.0833' }]);
    expect(r[0].newQuantity.toString()).toBe('1');
  });
  it('knows whether anything is returned', () => {
    expect(hasReturnedQuantity(resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: 0 }]))).toBe(false);
    expect(hasReturnedQuantity(resolveReturnQuantities([lineA], [{ sellLineId: 1, quantity: 1 }]))).toBe(true);
  });
});

describe('planMappingChange (FIFO qty_returned / quantity_sold)', () => {
  const m = (id: number, pl: number, q: number, r = 0): SellPurchaseMapping => ({ id, purchaseLineId: pl, quantity: D(q), qtyReturned: D(r) });

  it('does nothing for a zero difference', () => {
    expect(planMappingChange([m(1, 10, 5)], D(0)).updates).toEqual([]);
  });
  it('a return fills the first mapping, then spills into the next', () => {
    const plan = planMappingChange([m(1, 10, 3), m(2, 11, 4)], D(5));
    expect(plan.updates.map((u) => [u.mappingId, u.qtyReturnedDelta.toString(), u.quantitySoldDelta.toString()])).toEqual([
      [1, '3', '-3'],
      [2, '2', '-2'],
    ]);
    expect(plan.unallocated.toString()).toBe('0');
  });
  it('skips rows that are already fully returned', () => {
    const plan = planMappingChange([m(1, 10, 3, 3), m(2, 11, 4, 1)], D(2));
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].mappingId).toBe(2);
    expect(plan.updates[0].qtyReturnedDelta.toString()).toBe('2');
  });
  it('reports what no mapping can absorb (legacy sales without FIFO rows)', () => {
    expect(planMappingChange([m(1, 10, 2)], D(5)).unallocated.toString()).toBe('3');
    expect(planMappingChange([], D(1)).unallocated.toString()).toBe('1');
  });
  it('reducing a return takes back qty_returned and raises quantity_sold', () => {
    const plan = planMappingChange([m(1, 10, 3, 3), m(2, 11, 4, 2)], D(-4));
    expect(plan.updates.map((u) => [u.mappingId, u.qtyReturnedDelta.toString(), u.quantitySoldDelta.toString()])).toEqual([
      [1, '-3', '3'],
      [2, '-1', '1'],
    ]);
  });
  it('never puts back more than was returned (the original over-counts a partly returned row)', () => {
    const plan = planMappingChange([m(1, 10, 5, 0), m(2, 11, 5, 2)], D(-2));
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].mappingId).toBe(2);
    expect(plan.updates[0].quantitySoldDelta.toString()).toBe('2');
  });
  it('apply then undo returns the mapping to its start', () => {
    const start = [m(1, 10, 3), m(2, 11, 4)];
    const up = planMappingChange(start, D(6));
    const mid = applyMappingPlan(start, up);
    expect(mid.map((x) => x.qtyReturned.toString())).toEqual(['3', '3']);
    const down = planMappingChange(mid, D(-6));
    expect(applyMappingPlan(mid, down).map((x) => x.qtyReturned.toString())).toEqual(['0', '0']);
  });
  it('quantity_sold changes mirror qty_returned changes exactly', () => {
    const plan = planMappingChange([m(1, 10, 3), m(2, 11, 4), m(3, 12, 5)], D('7.5'));
    const sumReturned = plan.updates.reduce((s, u) => s.add(u.qtyReturnedDelta), D(0));
    const sumSold = plan.updates.reduce((s, u) => s.add(u.quantitySoldDelta), D(0));
    expect(sumReturned.toString()).toBe('7.5');
    expect(sumSold.toString()).toBe('-7.5');
  });
});

describe('stock', () => {
  it('only products with stock management move qty_available', () => {
    expect(stockChange(true, D(3)).toString()).toBe('3');
    expect(stockChange(true, D(-2)).toString()).toBe('-2');
    expect(stockChange(false, D(3)).toString()).toBe('0');
  });
});

describe('payment status of the return', () => {
  it('paid when final <= paid, partial when part is paid, due when nothing', () => {
    expect(calculatePaymentStatus('100', '100')).toBe('paid');
    expect(calculatePaymentStatus('100', '120')).toBe('paid');
    expect(calculatePaymentStatus('100', '40')).toBe('partial');
    expect(calculatePaymentStatus('100', '0')).toBe('due');
    expect(calculatePaymentStatus('100', null)).toBe('due');
  });
  it('a zero value return counts as paid (Laravel: 0 <= 0)', () => {
    expect(calculatePaymentStatus('0', '0')).toBe('paid');
  });
  it('netPaid subtracts is_return payments', () => {
    expect(netPaid([{ amount: '100' }, { amount: '30', isReturn: true }, { amount: '5.5', isReturn: false }]).toString()).toBe('75.5');
    expect(netPaid([]).toString()).toBe('0');
  });
  it('refundDue never goes below zero', () => {
    expect(refundDue('100', '40').toString()).toBe('60');
    expect(refundDue('100', '140').toString()).toBe('0');
  });
  it('validates a refund payment', () => {
    expect(validateRefundPayment({ amount: 60, status: 'partial', finalTotal: '100', totalPaid: '40' }).toString()).toBe('60');
    expect(() => validateRefundPayment({ amount: 61, status: 'partial', finalTotal: '100', totalPaid: '40' })).toThrow('more than the balance');
    expect(() => validateRefundPayment({ amount: 1, status: 'paid', finalTotal: '100', totalPaid: '100' })).toThrow('already fully refunded');
    expect(() => validateRefundPayment({ amount: 0, status: 'due', finalTotal: '100', totalPaid: '0' })).toThrow('more than zero');
  });
});

describe('reward points', () => {
  const settings: RewardSettings = { enableRp: true, minOrderTotalForRp: 100, amountForUnitRp: 50, maxRpPerOrder: null, rpExpiryPeriod: null, rpExpiryType: 'year' };

  it('floor(total / amount per point), nothing below the minimum order, capped by the maximum', () => {
    expect(calculateRewardPoints(settings, 275)).toBe(5);
    expect(calculateRewardPoints(settings, 99)).toBe(0);
    expect(calculateRewardPoints({ ...settings, maxRpPerOrder: 3 }, 1000)).toBe(3);
    expect(calculateRewardPoints({ ...settings, enableRp: false }, 1000)).toBe(0);
    expect(calculateRewardPoints({ ...settings, amountForUnitRp: 0 }, 1000)).toBe(0);
  });
  it('expires after the configured period', () => {
    const sale = new Date('2025-01-15T00:00:00Z');
    expect(rewardExpired(sale, new Date('2025-12-01T00:00:00Z'), { rpExpiryPeriod: 1, rpExpiryType: 'year' })).toBe(false);
    expect(rewardExpired(sale, new Date('2026-02-01T00:00:00Z'), { rpExpiryPeriod: 1, rpExpiryType: 'year' })).toBe(true);
    expect(rewardExpired(sale, new Date('2025-03-01T00:00:00Z'), { rpExpiryPeriod: 1, rpExpiryType: 'month' })).toBe(true);
    expect(rewardExpired(sale, new Date('2030-01-01T00:00:00Z'), { rpExpiryPeriod: null, rpExpiryType: 'year' })).toBe(false);
  });
  it('recalculates the points on (sale - return) and moves the customer by the difference', () => {
    const base = { settings, saleFinalTotal: 500, returnFinalTotal: 200, saleRpEarned: 10, saleDate: new Date('2026-10-01T00:00:00Z'), now: new Date('2026-10-20T00:00:00Z'), customerIsDefault: false };
    expect(rewardAdjustmentForReturn(base)).toEqual({ saleRpEarned: 6, customerDelta: -4 });
    expect(rewardAdjustmentForReturn({ ...base, customerIsDefault: true })).toEqual({ saleRpEarned: 6, customerDelta: 0 });
  });
  it('does nothing when points are off, the sale earned none, or they expired', () => {
    const base = { settings, saleFinalTotal: 500, returnFinalTotal: 200, saleRpEarned: 10, saleDate: new Date('2024-01-01T00:00:00Z'), now: new Date('2026-10-20T00:00:00Z'), customerIsDefault: false };
    expect(rewardAdjustmentForReturn({ ...base, settings: { ...settings, enableRp: false } })).toBeNull();
    expect(rewardAdjustmentForReturn({ ...base, saleRpEarned: 0 })).toBeNull();
    expect(rewardAdjustmentForReturn({ ...base, settings: { ...settings, rpExpiryPeriod: 1, rpExpiryType: 'year' } })).toBeNull();
  });
});

describe('dayRange (business time zone)', () => {
  it('maps whole days of Asia/Colombo to a half-open range of instants', () => {
    const r = dayRange('2026-10-01', '2026-10-02', 'Asia/Colombo');
    expect(r.gte?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.lt?.toISOString()).toBe('2026-10-02T18:30:00.000Z');
  });
  it('either side may be missing; an inverted range is refused', () => {
    expect(dayRange(undefined, undefined, 'UTC')).toEqual({});
    expect(dayRange('2026-10-01', undefined, 'UTC').lt).toBeUndefined();
    expect(() => dayRange('2026-10-05', '2026-10-01', 'UTC')).toThrow();
  });
});
