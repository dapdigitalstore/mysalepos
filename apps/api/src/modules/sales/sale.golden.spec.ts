import { Prisma } from '@prisma/client';
import { calculateInvoiceTotals, calculateLine, paymentStatus, totalPaid } from './sale.rules';

/**
 * "Golden" fixtures: literal rows copied (read-only SELECT) from real sales stored by the Laravel app in the local database
 * (business 4 "Ella Ceylonka Restaurant" and business 1 "My Sale POS"). The rules must reproduce the stored totals and payment status.
 * The tests never touch the database.
 *
 * Whole-database comparison (1,099 sell transactions, 3,189 lines): see docs/SALES-API.md "Golden data check".
 */

interface GoldenLine { qty: string; upbd: string; upit: string; ldt?: 'fixed' | 'percentage'; lda?: string; itemTax?: string; unitPrice?: string }
interface GoldenSale {
  id: number;
  rate: number;
  discountType: 'fixed' | 'percentage';
  discountAmount: string;
  totalBeforeTax: string;
  taxAmount: string;
  finalTotal: string;
  paymentStatus: 'paid' | 'due' | 'partial';
  lines: GoldenLine[];
  payments: Array<{ amount: string; isReturn: boolean }>;
}

const SALES: GoldenSale[] = [
  { id: 861, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '4000', taxAmount: '300', finalTotal: '3300', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1300', upit: '1300' }, { qty: '1', upbd: '1800', upit: '1800' }, { qty: '1', upbd: '900', upit: '900' }], payments: [{ amount: '3300', isReturn: false }] },
  { id: 862, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '1300', taxAmount: '97.5', finalTotal: '1072.5', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1300', upit: '1300' }], payments: [{ amount: '1072.5', isReturn: false }] },
  { id: 864, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '10800', taxAmount: '810', finalTotal: '8910', paymentStatus: 'paid', lines: [{ qty: '6', upbd: '1800', upit: '1800' }], payments: [{ amount: '8910', isReturn: false }] },
  { id: 868, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '5760', taxAmount: '432', finalTotal: '4752', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1700', upit: '1700' }, { qty: '1', upbd: '1800', upit: '1800' }, { qty: '1', upbd: '1600', upit: '1600' }, { qty: '1', upbd: '300', upit: '300' }, { qty: '1', upbd: '360', upit: '360' }], payments: [{ amount: '4752', isReturn: false }] },
  { id: 884, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '3700', taxAmount: '277.5', finalTotal: '3052.5', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1100', upit: '1100' }, { qty: '2', upbd: '1300', upit: '1300' }], payments: [{ amount: '3052.5', isReturn: false }] },
  { id: 909, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '2850', taxAmount: '213.75', finalTotal: '2351.25', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1250', upit: '1250' }, { qty: '1', upbd: '200', upit: '200' }, { qty: '1', upbd: '1400', upit: '1400' }], payments: [{ amount: '2351.25', isReturn: false }] },
  { id: 1053, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '7750', taxAmount: '581.25', finalTotal: '6393.75', paymentStatus: 'paid', lines: [{ qty: '3', upbd: '1000', upit: '1000' }, { qty: '1', upbd: '3750', upit: '3750' }, { qty: '1', upbd: '1000', upit: '1000' }], payments: [{ amount: '6393.75', isReturn: false }] },
  // tax, no discount
  { id: 664, rate: 10, discountType: 'percentage', discountAmount: '0', totalBeforeTax: '10700', taxAmount: '1070', finalTotal: '11770', paymentStatus: 'paid', lines: [{ qty: '2', upbd: '1800', upit: '1800' }, { qty: '1', upbd: '2200', upit: '2200' }, { qty: '1', upbd: '1800', upit: '1800' }, { qty: '1', upbd: '400', upit: '400' }, { qty: '1', upbd: '200', upit: '200' }, { qty: '1', upbd: '1500', upit: '1500' }, { qty: '1', upbd: '1000', upit: '1000' }], payments: [{ amount: '11880', isReturn: false }, { amount: '110', isReturn: true }] },
  // customer paid 11385 in cash and got 1567.5 back
  { id: 1012, rate: 10, discountType: 'percentage', discountAmount: '25', totalBeforeTax: '11900', taxAmount: '892.5', finalTotal: '9817.5', paymentStatus: 'paid', lines: [{ qty: '3', upbd: '1700', upit: '1700' }, { qty: '3', upbd: '1000', upit: '1000' }, { qty: '2', upbd: '1900', upit: '1900' }], payments: [{ amount: '11385', isReturn: false }, { amount: '1567.5', isReturn: true }] },
  // no tax at all (business 1)
  { id: 2, rate: 0, discountType: 'percentage', discountAmount: '0', totalBeforeTax: '562.5', taxAmount: '0', finalTotal: '562.5', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '562.5', upit: '562.5', ldt: 'fixed', lda: '0' }], payments: [{ amount: '562.5', isReturn: false }] },
  { id: 1200, rate: 0, discountType: 'percentage', discountAmount: '0', totalBeforeTax: '1687.5', taxAmount: '0', finalTotal: '1687.5', paymentStatus: 'paid', lines: [{ qty: '3', upbd: '562.5', upit: '562.5', ldt: 'fixed', lda: '0' }], payments: [{ amount: '1687.5', isReturn: false }] },
  // a sale with no payment at all
  { id: 6, rate: 0, discountType: 'percentage', discountAmount: '0', totalBeforeTax: '562.5', taxAmount: '0', finalTotal: '562.5', paymentStatus: 'due', lines: [{ qty: '1', upbd: '562.5', upit: '562.5', ldt: 'fixed', lda: '0' }], payments: [] },
  // no tax, no discount, six lines
  { id: 134, rate: 0, discountType: 'percentage', discountAmount: '0', totalBeforeTax: '12900', taxAmount: '0', finalTotal: '12900', paymentStatus: 'paid', lines: [{ qty: '1', upbd: '1000', upit: '1000' }, { qty: '1', upbd: '1800', upit: '1800' }, { qty: '1', upbd: '2900', upit: '2900' }, { qty: '1', upbd: '2400', upit: '2400' }, { qty: '1', upbd: '2600', upit: '2600' }, { qty: '1', upbd: '2200', upit: '2200' }], payments: [{ amount: '12900', isReturn: false }] },
];

const total = (s: GoldenSale) => {
  const lines = s.lines.map((l) => calculateLine({ quantity: l.qty, unitPrice: l.upbd, discountType: l.ldt, discountAmount: l.lda, taxRate: 0 }, 2));
  return { lines, totals: calculateInvoiceTotals({ lineTotals: lines.map((l) => l.lineTotal), discountType: s.discountType, discountAmount: s.discountAmount, taxRate: s.rate, precision: 2 }) };
};

describe('golden sales stored by Laravel', () => {
  it.each(SALES.map((s) => [s.id, s] as const))('sale %i: totals and payment status are reproduced', (_id, s) => {
    const { lines, totals } = total(s);
    lines.forEach((l, i) => expect(l.stored.unit_price_inc_tax.toFixed()).toBe(new Prisma.Decimal(s.lines[i].upit).toFixed()));
    expect(totals.totalBeforeTax.toFixed()).toBe(new Prisma.Decimal(s.totalBeforeTax).toFixed());
    expect(totals.taxAmount.toFixed()).toBe(new Prisma.Decimal(s.taxAmount).toFixed());
    expect(totals.finalTotal.toFixed()).toBe(new Prisma.Decimal(s.finalTotal).toFixed());
    const paid = totalPaid(s.payments);
    expect(paymentStatus(totals.finalTotal, paid)).toBe(s.paymentStatus);
  });

  it('sale 896 is the one stored inconsistency: Laravel saved a final_total (4180) that its own parts (3600 + 360 tax = 3960) do not give', () => {
    const t = calculateInvoiceTotals({ lineTotals: [new Prisma.Decimal(2400), new Prisma.Decimal(600), new Prisma.Decimal(600)], discountType: 'percentage', discountAmount: 0, taxRate: 10, precision: 2 });
    expect(t.totalBeforeTax.toFixed()).toBe('3600');
    expect(t.taxAmount.toFixed()).toBe('360');
    expect(t.finalTotal.toFixed()).toBe('3960');
    // it was paid 4180, so the stored status is "paid" and so is ours
    expect(paymentStatus('4180', totalPaid([{ amount: '4180' }]))).toBe('paid');
  });
});
