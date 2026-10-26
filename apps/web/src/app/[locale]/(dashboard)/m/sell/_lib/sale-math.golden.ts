/**
 * Dependency-free self check of the live totals maths (the web app has no test runner yet).
 * The cases are the golden examples of the API tests (apps/api/src/modules/sales/sale.golden.spec.ts, sale.rules.spec.ts)
 * and docs/SALES-API.md section 3.3. `runSaleMathChecks()` returns the descriptions of the cases that fail (empty = all fine).
 * To run it: transpile `decimal.ts`, `sale-math.ts` and this file (tsc --module commonjs) and call it from node.
 */
import { dec, mulDiv, toFixed, toText } from './decimal';
import { calcInvoice, calcLine, cashSuggestions, remainingForRow, summarizePayments, type DiscountType } from './sale-math';

const CP = 2;

interface L {
  q: string;
  p: string;
  dt?: DiscountType;
  da?: string;
  tax?: string;
}

interface Case {
  name: string;
  lines: L[];
  discountType?: DiscountType;
  discountAmount?: string;
  orderTax?: string;
  shipping?: string;
  extra?: string[];
  rounding?: string | null;
  paid?: string[];
  expect: { totalBeforeTax?: string; tax?: string; finalTotal: string; change?: string; status?: string };
}

const CASES: Case[] = [
  {
    name: 'SALES-API 3.3 example (25% discount, 10% tax, tendered 5000)',
    lines: [{ q: '2', p: '1700' }, { q: '1', p: '1250', dt: 'fixed', da: '50' }],
    discountType: 'percentage',
    discountAmount: '25',
    orderTax: '10',
    paid: ['5000'],
    expect: { totalBeforeTax: '4600.00', tax: '345.00', finalTotal: '3795.00', change: '1205.00', status: 'paid' },
  },
  { name: 'golden sale 862', lines: [{ q: '1', p: '1300' }], discountType: 'percentage', discountAmount: '25', orderTax: '10', paid: ['1072.5'], expect: { totalBeforeTax: '1300.00', tax: '97.50', finalTotal: '1072.50', change: '0.00', status: 'paid' } },
  {
    name: 'golden sale 868',
    lines: [{ q: '1', p: '1700' }, { q: '1', p: '1800' }, { q: '1', p: '1600' }, { q: '1', p: '300' }, { q: '1', p: '360' }],
    discountType: 'percentage',
    discountAmount: '25',
    orderTax: '10',
    expect: { totalBeforeTax: '5760.00', tax: '432.00', finalTotal: '4752.00' },
  },
  {
    name: 'golden sale 1012 (change given back)',
    lines: [{ q: '3', p: '1700' }, { q: '3', p: '1000' }, { q: '2', p: '1900' }],
    discountType: 'percentage',
    discountAmount: '25',
    orderTax: '10',
    paid: ['11385'],
    expect: { totalBeforeTax: '11900.00', tax: '892.50', finalTotal: '9817.50', change: '1567.50', status: 'paid' },
  },
  {
    name: 'golden sale 664 (tax, no discount, change 110)',
    lines: [{ q: '2', p: '1800' }, { q: '1', p: '2200' }, { q: '1', p: '1800' }, { q: '1', p: '400' }, { q: '1', p: '200' }, { q: '1', p: '1500' }, { q: '1', p: '1000' }],
    orderTax: '10',
    paid: ['11880'],
    expect: { totalBeforeTax: '10700.00', tax: '1070.00', finalTotal: '11770.00', change: '110.00', status: 'paid' },
  },
  { name: 'golden sale 6 (nothing paid)', lines: [{ q: '1', p: '562.5' }], paid: [], expect: { finalTotal: '562.50', status: 'due' } },
  { name: 'line tax 12.5%', lines: [{ q: '3', p: '1000', tax: '12.5' }], expect: { totalBeforeTax: '3375.00', tax: '0.00', finalTotal: '3375.00' } },
  { name: 'line % discount and tax rounding', lines: [{ q: '2', p: '99.99', dt: 'percentage', da: '10', tax: '15' }], expect: { totalBeforeTax: '206.98', finalTotal: '206.98' } },
  { name: 'shipping, extra charge, rounding to 0.05', lines: [{ q: '1', p: '100.02' }], shipping: '50', extra: ['10.01'], rounding: '0.05', expect: { finalTotal: '160.05' } },
  { name: 'rounding to 1 goes half up', lines: [{ q: '1', p: '100.5' }], rounding: '1', expect: { finalTotal: '101.00' } },
  { name: 'fixed discount then tax', lines: [{ q: '1', p: '100' }], discountType: 'fixed', discountAmount: '30', orderTax: '10', expect: { tax: '7.00', finalTotal: '77.00' } },
  { name: 'partial payment', lines: [{ q: '1', p: '1000' }], paid: ['300', '200'], expect: { finalTotal: '1000.00', status: 'partial', change: '0.00' } },
];

export function runSaleMathChecks(): string[] {
  const failures: string[] = [];
  const check = (name: string, got: string, want: string | undefined) => {
    if (want !== undefined && got !== want) failures.push(`${name}: got ${got}, want ${want}`);
  };
  for (const c of CASES) {
    const lines = c.lines.map((l) =>
      calcLine({ quantity: l.q, unitPrice: l.p, discountType: l.dt ?? 'fixed', discountAmount: l.da ?? '0', taxRate: l.tax ?? '0' }, CP),
    );
    const t = calcInvoice({
      lineTotals: lines.map((l) => l.lineTotal),
      discountType: c.discountType ?? 'fixed',
      discountAmount: c.discountAmount ?? '0',
      taxRate: c.orderTax ?? '0',
      shippingCharges: c.shipping ?? '',
      additionalExpenses: c.extra ?? [],
      roundingMultiple: c.rounding ?? null,
      currencyPrecision: CP,
    });
    check(`${c.name} / total before tax`, toFixed(t.totalBeforeTax, CP), c.expect.totalBeforeTax);
    check(`${c.name} / tax`, toFixed(t.tax, CP), c.expect.tax);
    check(`${c.name} / final total`, toFixed(t.finalTotal, CP), c.expect.finalTotal);
    if (c.paid) {
      const s = summarizePayments(t.finalTotal, c.paid);
      check(`${c.name} / change`, toFixed(s.change, CP), c.expect.change);
      check(`${c.name} / status`, s.status, c.expect.status);
    }
  }
  check('remaining for the second row', toFixed(remainingForRow(dec('1000'), ['300', '200'], 1), CP), '700.00');
  check('cash suggestions', cashSuggestions(dec('1240')).map((x) => toText(x)).join(','), '1250,1300,1500');
  check('sub-unit division', toText(mulDiv(dec('100'), dec('1'), dec('3'), 4)), '33.3333');
  return failures;
}
