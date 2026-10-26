import { Prisma } from '@prisma/client';
import {
  accountTransactionType,
  calculateInvoiceTotals,
  calculateLine,
  canBeEdited,
  comboChildLines,
  creditLimitExceeded,
  customerGroupPrice,
  displayPaymentStatus,
  expectedUnitPriceExcTax,
  formatInvoiceNumber,
  groupPriceFor,
  hasShippingData,
  assertPayable,
  isKnownPaymentMethod,
  parseComboComponents,
  parseIdList,
  linePermissions,
  normalizePaymentRows,
  parsePosSettings,
  paymentStatus,
  permittedLocations,
  priceChangeAllowed,
  resolveStatus,
  rewardPointsChange,
  rewardPointsEarned,
  roundingMultipleOf,
  saleVisibility,
  showOwnOnly,
  totalPaid,
  unitMultiplier,
} from './sale.rules';

const D = (v: string | number) => new Prisma.Decimal(v);
const user = (permissions: string[], extra: Partial<{ isAdmin: boolean; isSuperadmin: boolean }> = {}) => ({
  isAdmin: false,
  isSuperadmin: false,
  permissions,
  ...extra,
});

describe('resolveStatus', () => {
  it('turns quotation and proforma into drafts with a sub status', () => {
    expect(resolveStatus('quotation')).toEqual({ status: 'draft', isQuotation: true, subStatus: 'quotation' });
    expect(resolveStatus('proforma')).toEqual({ status: 'draft', isQuotation: false, subStatus: 'proforma' });
    expect(resolveStatus('final')).toEqual({ status: 'final', isQuotation: false, subStatus: null });
    expect(resolveStatus('draft')).toEqual({ status: 'draft', isQuotation: false, subStatus: null });
  });
});

describe('calculateLine', () => {
  it('prices a plain line', () => {
    const l = calculateLine({ quantity: 2, unitPrice: 1800 }, 2);
    expect(l.unitPriceIncTax.toFixed()).toBe('1800');
    expect(l.itemTax.toFixed()).toBe('0');
    expect(l.lineTotal.toFixed()).toBe('3600');
    expect(l.stored.quantity.toFixed()).toBe('2');
    expect(l.stored.line_discount_type).toBeNull();
  });

  it('adds the line tax on top of the discounted price (pos_each_row)', () => {
    const l = calculateLine({ quantity: 3, unitPrice: 100, discountType: 'percentage', discountAmount: 10, taxRate: 15 }, 2);
    // 100 - 10% = 90 ; + 15% = 103.50 ; tax 13.50
    expect(l.discountedUnitPrice.toFixed()).toBe('90');
    expect(l.unitPriceIncTax.toFixed()).toBe('103.5');
    expect(l.itemTax.toFixed()).toBe('13.5');
    expect(l.lineTotal.toFixed()).toBe('310.5');
    expect(l.stored.unit_price.toFixed()).toBe('90');
    expect(l.stored.line_discount_type).toBe('percentage');
    expect(l.stored.line_discount_amount.toFixed()).toBe('10');
  });

  it('applies a fixed line discount per unit', () => {
    const l = calculateLine({ quantity: 1, unitPrice: 250, discountType: 'fixed', discountAmount: 25, taxRate: 10 }, 2);
    expect(l.discountedUnitPrice.toFixed()).toBe('225');
    expect(l.unitPriceIncTax.toFixed()).toBe('247.5');
    expect(l.itemTax.toFixed()).toBe('22.5');
  });

  it('rounds the inc-tax price to the currency precision, half up', () => {
    const l = calculateLine({ quantity: 1, unitPrice: '10.01', taxRate: 12.5 }, 2);
    // 10.01 x 1.125 = 11.26125 -> 11.26 ; tax 1.25125 -> 1.25
    expect(l.unitPriceIncTax.toFixed()).toBe('11.26');
    expect(l.itemTax.toFixed()).toBe('1.25');
    const m = calculateLine({ quantity: 1, unitPrice: '0.125' }, 2);
    expect(m.unitPriceIncTax.toFixed()).toBe('0.13');
  });

  it('stores per base unit when a sub-unit is sold (multiplier 12: a dozen)', () => {
    const l = calculateLine({ quantity: 2, unitPrice: 120, discountType: 'fixed', discountAmount: 12, taxRate: 10, multiplier: 12 }, 2);
    // dozen price 120 - 12 = 108 -> 118.8 inc tax, item tax 10.8
    expect(l.unitPriceIncTax.toFixed()).toBe('118.8');
    expect(l.lineTotal.toFixed()).toBe('237.6');
    expect(l.stored.quantity.toFixed()).toBe('24');
    expect(l.stored.unit_price_before_discount.toFixed()).toBe('10');
    expect(l.stored.unit_price.toFixed()).toBe('9');
    expect(l.stored.line_discount_amount.toFixed()).toBe('1');
    expect(l.stored.unit_price_inc_tax.toFixed()).toBe('9.9');
    expect(l.stored.item_tax.toFixed()).toBe('0.9');
  });

  it('keeps a percentage discount unchanged by the multiplier', () => {
    const l = calculateLine({ quantity: 1, unitPrice: 120, discountType: 'percentage', discountAmount: 5, multiplier: 12 }, 2);
    expect(l.stored.line_discount_amount.toFixed()).toBe('5');
    expect(l.stored.unit_price.toFixed()).toBe('9.5');
  });
});

describe('calculateInvoiceTotals', () => {
  const base = { precision: 2 };

  it('matches a real stored sale: 4000 with 25% discount and 10% tax = 3300 (transaction 861)', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [D(1300), D(1800), D(900)], discountType: 'percentage', discountAmount: 25, taxRate: 10 });
    expect(t.totalBeforeTax.toFixed()).toBe('4000');
    expect(t.discountValue.toFixed()).toBe('1000');
    expect(t.taxAmount.toFixed()).toBe('300');
    expect(t.finalTotal.toFixed()).toBe('3300');
  });

  it('fixed discount, shipping and additional expenses', () => {
    const t = calculateInvoiceTotals({
      ...base,
      lineTotals: [D(500), D('250.50')],
      discountType: 'fixed',
      discountAmount: 50,
      taxRate: 5,
      shippingCharges: 40,
      additionalExpenses: [10, '5.25'],
    });
    // tbt 750.50 ; tax 5% of 700.50 = 35.025 ; total = 750.5 + 35.025 - 50 + 40 + 15.25 = 790.775 -> 790.78
    expect(t.totalBeforeTax.toFixed()).toBe('750.5');
    expect(t.taxAmount.toFixed()).toBe('35.025');
    expect(t.finalTotal.toFixed()).toBe('790.78');
  });

  it('no discount type means no discount even when an amount is sent', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [D(100)], discountAmount: 20 });
    expect(t.discountValue.toFixed()).toBe('0');
    expect(t.finalTotal.toFixed()).toBe('100');
  });

  it('percent packing charge is taken from the sub total', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [D(200)], packingCharge: 10, packingChargeType: 'percent' });
    expect(t.packingChargeValue.toFixed()).toBe('20');
    expect(t.finalTotal.toFixed()).toBe('220');
  });

  it('reward points reduce the total and the taxable amount', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [D(1000)], taxRate: 10, rpRedeemedAmount: 100 });
    expect(t.taxAmount.toFixed()).toBe('90');
    expect(t.finalTotal.toFixed()).toBe('990');
  });

  it('rounds to the rounding multiple and records the round off amount', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [D('103.52')], roundingMultiple: '0.05' });
    expect(t.finalTotal.toFixed()).toBe('103.5');
    expect(t.roundOffAmount.toFixed()).toBe('-0.02');
    const u = calculateInvoiceTotals({ ...base, lineTotals: [D('103.53')], roundingMultiple: 5 });
    expect(u.finalTotal.toFixed()).toBe('105');
    expect(u.roundOffAmount.toFixed()).toBe('1.47');
  });

  it('handles an empty discount rate and no lines', () => {
    const t = calculateInvoiceTotals({ ...base, lineTotals: [] });
    expect(t.finalTotal.toFixed()).toBe('0');
  });
});

describe('payment status', () => {
  it('follows calculatePaymentStatus', () => {
    expect(paymentStatus(100, 0)).toBe('due');
    expect(paymentStatus(100, 40)).toBe('partial');
    expect(paymentStatus(100, 100)).toBe('paid');
    expect(paymentStatus(100, 120)).toBe('paid');
    expect(paymentStatus(0, 0)).toBe('paid');
  });

  it('subtracts change given back from what was paid', () => {
    const paid = totalPaid([{ amount: 5000 }, { amount: '650.50', isReturn: true }]);
    expect(paid.toFixed()).toBe('4349.5');
    expect(paymentStatus('4349.5', paid)).toBe('paid');
  });

  it('shows overdue once the pay term has passed', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    expect(displayPaymentStatus('due', 10, 'days', date, new Date('2026-01-20T00:00:00Z'))).toBe('overdue');
    expect(displayPaymentStatus('partial', 1, 'months', date, new Date('2026-03-01T00:00:00Z'))).toBe('partial-overdue');
    expect(displayPaymentStatus('due', 10, 'days', date, new Date('2026-01-05T00:00:00Z'))).toBe('due');
    expect(displayPaymentStatus('paid', 10, 'days', date, new Date('2027-01-05T00:00:00Z'))).toBe('paid');
    expect(displayPaymentStatus('due', null, null, date, new Date('2027-01-05T00:00:00Z'))).toBe('due');
  });
});

describe('normalizePaymentRows', () => {
  it('skips zero amount rows but keeps edits of existing payments', () => {
    const rows = normalizePaymentRows([{ method: 'cash', amount: 0 }, { method: 'card', amount: 10 }, { id: 5, method: 'cash', amount: 0 }], 0);
    expect(rows.map((r) => r.method)).toEqual(['card', 'cash']);
  });

  it('refuses advance payments above the advance balance', () => {
    expect(() => normalizePaymentRows([{ method: 'advance', amount: 60 }, { method: 'advance', amount: 50 }], 100)).toThrow('advance balance');
    expect(normalizePaymentRows([{ method: 'advance', amount: 100 }], 100)).toHaveLength(1);
  });

  it('requires a method and rejects negative amounts', () => {
    expect(() => normalizePaymentRows([{ method: ' ', amount: 5 }], 0)).toThrow('method');
    expect(() => normalizePaymentRows([{ method: 'cash', amount: -5 }], 0)).toThrow('negative');
  });

  it('change given back is a debit on the account', () => {
    expect(accountTransactionType(true)).toBe('debit');
    expect(accountTransactionType(false)).toBe('credit');
  });
});

describe('creditLimitExceeded', () => {
  const base = { status: 'final' as const, finalTotal: 1000, currentPayments: 0, creditLimit: 5000, otherInvoiceTotal: 3000, otherInvoicePaid: 0 };
  it('is false for drafts, fully paid sales and customers without a limit', () => {
    expect(creditLimitExceeded({ ...base, status: 'draft' })).toBe(false);
    expect(creditLimitExceeded({ ...base, currentPayments: 1000 })).toBe(false);
    expect(creditLimitExceeded({ ...base, creditLimit: null })).toBe(false);
  });
  it('returns the limit when outstanding + this due is above it', () => {
    expect(String(creditLimitExceeded({ ...base, otherInvoiceTotal: 4500 }))).toBe('5000');
    expect(creditLimitExceeded(base)).toBe(false);
    expect(creditLimitExceeded({ ...base, otherInvoiceTotal: 4500, otherInvoicePaid: 600 })).toBe(false);
  });
  it('a limit of 0 is enforced (walk-in customers cannot buy on credit)', () => {
    expect(String(creditLimitExceeded({ ...base, creditLimit: 0, otherInvoiceTotal: 0 }))).toBe('0');
  });
});

describe('reward points', () => {
  const s = { enableRp: true, minOrderTotalForRp: 100, amountForUnitRp: 50, maxRpPerOrder: 10 };
  it('earns floor(total / amount per point), capped', () => {
    expect(rewardPointsEarned(260, s)).toBe(5);
    expect(rewardPointsEarned(99, s)).toBe(0);
    expect(rewardPointsEarned(5000, s)).toBe(10);
    expect(rewardPointsEarned(5000, { ...s, enableRp: false })).toBe(0);
  });
  it('computes the change of the customer balance', () => {
    expect(rewardPointsChange(5, 0, 2, 0)).toEqual({ totalRpDelta: 3, usedDelta: 2 });
    expect(rewardPointsChange(4, 5, 0, 2)).toEqual({ totalRpDelta: 1, usedDelta: -2 });
    expect(rewardPointsChange(0, 5, 0, 2)).toEqual({ totalRpDelta: -3, usedDelta: -2 });
  });
});

describe('formatInvoiceNumber', () => {
  const scheme = { scheme_type: 'year' as const, number_type: 'sequential', prefix: null, start_number: 1, invoice_count: 1106, total_digits: 4 };
  it('year scheme: prefix + year + - + padded counter (real invoice 2026-1107)', () => {
    expect(formatInvoiceNumber(scheme, 2026)).toBe('2026-1107');
  });
  it('blank scheme has no year', () => {
    expect(formatInvoiceNumber({ ...scheme, scheme_type: 'blank', prefix: 'INV', invoice_count: 6 }, 2026)).toBe('INV0007');
  });
  it('pads and supports a start number', () => {
    expect(formatInvoiceNumber({ ...scheme, prefix: 'S', start_number: 100, invoice_count: 0, total_digits: 6 }, 2025)).toBe('S2025-000100');
  });
  it('random scheme draws a number between 1000 and 9 x 111..1', () => {
    expect(formatInvoiceNumber({ ...scheme, scheme_type: 'blank', number_type: 'random' }, 2026, () => 0)).toBe('1000');
    expect(formatInvoiceNumber({ ...scheme, scheme_type: 'blank', number_type: 'random' }, 2026, () => 0.999999)).toMatch(/^\d{4}$/);
  });
});

describe('canBeEdited', () => {
  it('allows editing until transaction_edit_days after the sale date', () => {
    const today = new Date('2026-03-31T00:00:00Z');
    expect(canBeEdited(new Date('2026-03-01T10:00:00Z'), 30, today)).toBe(true);
    expect(canBeEdited(new Date('2026-02-28T10:00:00Z'), 30, today)).toBe(false);
  });
});

describe('comboChildLines', () => {
  it('moves component prices by the percentage that matches the combo price', () => {
    // components 2 x 60 + 1 x 80 = 200 ; combo sold for 180 (one combo) -> -10 %
    const lines = comboChildLines(
      [
        { productId: 1, variationId: 11, quantity: D(2), sellPriceIncTax: D(60) },
        { productId: 2, variationId: 22, quantity: D(1), sellPriceIncTax: D(80) },
      ],
      D(180),
      D(1),
    );
    expect(lines.map((l) => l.unitPrice.toFixed())).toEqual(['54', '72']);
    expect(lines[0].quantity.toFixed()).toBe('2');
  });
  it('keeps prices when there is no component value', () => {
    const lines = comboChildLines([{ productId: 1, variationId: 11, quantity: D(1), sellPriceIncTax: D(0) }], D(10), D(1));
    expect(lines[0].unitPrice.toFixed()).toBe('0');
  });
});

describe('prices and permissions', () => {
  it('group price: fixed or percentage, with the tax taken out', () => {
    expect(groupPriceFor('fixed', 110, 200, 10)).toEqual({ incTax: D(110), excTax: D(100) });
    expect(groupPriceFor('percentage', 90, 200, 0).incTax.toFixed()).toBe('180');
  });
  it('customer group percentage moves the price', () => {
    expect(customerGroupPrice(100, 10).toFixed()).toBe('110');
    expect(customerGroupPrice(100, -20).toFixed()).toBe('80');
    expect(customerGroupPrice(100, 0).toFixed()).toBe('100');
  });
  it('the expected price prefers the selling price group', () => {
    expect(expectedUnitPriceExcTax(100, D(80), 0).toFixed()).toBe('80');
    expect(expectedUnitPriceExcTax(100, null, 10).toFixed()).toBe('110');
    expect(expectedUnitPriceExcTax(100, D(0), 0).toFixed()).toBe('100');
  });
  it('only people with the permission may change the catalogue price', () => {
    expect(priceChangeAllowed(false, D('99.99'), D(100))).toBe(false);
    expect(priceChangeAllowed(false, D(100), D('100.00'))).toBe(true);
    // screens show 2 decimals, the catalogue keeps 4
    expect(priceChangeAllowed(false, D('33.33'), D('33.3333'), 2)).toBe(true);
    expect(priceChangeAllowed(false, D('33.33'), D('33.3333'), 4)).toBe(false);
    expect(priceChangeAllowed(true, D(1), D(100))).toBe(true);
  });
  it('line permissions differ on the POS and the add sale screen', () => {
    expect(linePermissions('pos').price).toBe('edit_product_price_from_pos_screen');
    expect(linePermissions('direct').discount).toBe('edit_product_discount_from_sale_screen');
  });
  it('unit multiplier is 1 for the own unit', () => {
    expect(unitMultiplier(3, 3, 12).toFixed()).toBe('1');
    expect(unitMultiplier(3, null, 12).toFixed()).toBe('1');
    expect(unitMultiplier(3, 9, 12).toFixed()).toBe('12');
    expect(unitMultiplier(3, 9, null).toFixed()).toBe('1');
  });
});

describe('visibility', () => {
  it('admins and users without partial permissions see everything', () => {
    expect(saleVisibility(user([], { isAdmin: true }))).toEqual({ locationIds: null, ownOnly: false, commissionAgentOnly: false });
    expect(saleVisibility(user(['sell.view', 'access_all_locations']))).toEqual({ locationIds: null, ownOnly: false, commissionAgentOnly: false });
  });
  it('view_own_sell_only limits to own sales and the permitted locations', () => {
    const v = saleVisibility(user(['sell.view', 'view_own_sell_only', 'location.4', 'location.7']));
    expect(v).toEqual({ locationIds: [4, 7], ownOnly: true, commissionAgentOnly: false });
  });
  it('commission agents also see sales assigned to them', () => {
    expect(saleVisibility(user(['sell.view', 'view_commission_agent_sell'])).commissionAgentOnly).toBe(true);
  });
  it('direct_sell.view lifts the own-sales restriction', () => {
    expect(saleVisibility(user(['direct_sell.view', 'view_own_sell_only'])).ownOnly).toBe(false);
  });
  it('permitted locations come from location.<id>', () => {
    expect(permittedLocations(user(['location.2', 'location.x', 'sell.view']))).toEqual([2]);
    expect(permittedLocations(user([], { isAdmin: true }))).toBeNull();
  });
  it('the detail view is own-only just for view_own_sell_only users', () => {
    expect(showOwnOnly(user(['view_own_sell_only']))).toBe(true);
    expect(showOwnOnly(user(['view_own_sell_only', 'sell.view']))).toBe(false);
    expect(showOwnOnly(user([], { isAdmin: true }))).toBe(false);
  });
});

describe('pos settings', () => {
  it('uses Laravel defaults when empty', () => {
    expect(parsePosSettings(null).disable_discount).toBe(0);
    expect(parsePosSettings('not json').is_pos_subtotal_editable).toBe(0);
  });
  it('parses stored JSON and the rounding multiple', () => {
    const s = parsePosSettings('{"amount_rounding_method":"0.05","allow_overselling":"1"}');
    expect(roundingMultipleOf(s).toFixed()).toBe('0.05');
    expect(roundingMultipleOf({ amount_rounding_method: null }).toFixed()).toBe('0');
    expect(roundingMultipleOf({ amount_rounding_method: 'none' }).toFixed()).toBe('0');
  });
});

describe('stored JSON and payment helpers', () => {
  it('parses sub unit ids and combo components', () => {
    expect(parseIdList('["12","13",0,"x"]')).toEqual([12, 13]);
    expect(parseIdList(null)).toEqual([]);
    expect(parseIdList('nope')).toEqual([]);
    const c = parseComboComponents('[{"variation_id":"5","quantity":"2.5","unit_id":"3"},{"variation_id":0,"quantity":1}]');
    expect(c).toHaveLength(1);
    expect(c[0].variationId).toBe(5);
    expect(c[0].quantity.toFixed()).toBe('2.5');
    expect(c[0].unitId).toBe(3);
    expect(parseComboComponents('[]')).toEqual([]);
  });

  it('knows the payment methods', () => {
    for (const m of ['cash', 'card', 'cheque', 'bank_transfer', 'other', 'advance', 'custom_pay_1', 'custom_pay_7']) expect(isKnownPaymentMethod(m)).toBe(true);
    for (const m of ['bitcoin', 'custom_pay_8', 'custom_pay_0']) expect(isKnownPaymentMethod(m)).toBe(false);
  });

  it('detects shipping data', () => {
    expect(hasShippingData({})).toBe(false);
    expect(hasShippingData({ shippingCharges: '0', shippingDetails: '  ' })).toBe(false);
    expect(hasShippingData({ shippingCharges: 50 })).toBe(true);
    expect(hasShippingData({ shippingStatus: 'packed' })).toBe(true);
  });

  it('only accepts payments up to the balance', () => {
    expect(() => assertPayable(100, 100, 5)).toThrow('already fully paid');
    expect(() => assertPayable(100, 40, 61)).toThrow('more than the due amount (60)');
    expect(() => assertPayable(100, 40, 60)).not.toThrow();
    expect(() => assertPayable(100, 0, '99.99')).not.toThrow();
  });
});

describe('worked example of docs/SALES-API.md', () => {
  it('2 x 1700 and 1 x (1250 - 50), 25% discount, 10% tax = 3795, change 1205 on 5000 tendered', () => {
    const a = calculateLine({ quantity: 2, unitPrice: 1700 }, 2);
    const b = calculateLine({ quantity: 1, unitPrice: 1250, discountType: 'fixed', discountAmount: 50 }, 2);
    const t = calculateInvoiceTotals({ lineTotals: [a.lineTotal, b.lineTotal], discountType: 'percentage', discountAmount: 25, taxRate: 10, precision: 2 });
    expect(t.totalBeforeTax.toFixed()).toBe('4600');
    expect(t.discountValue.toFixed()).toBe('1150');
    expect(t.taxAmount.toFixed()).toBe('345');
    expect(t.finalTotal.toFixed()).toBe('3795');
    const paid = totalPaid([{ amount: 5000 }, { amount: 1205, isReturn: true }]);
    expect(paymentStatus(t.finalTotal, paid)).toBe('paid');
  });
});
