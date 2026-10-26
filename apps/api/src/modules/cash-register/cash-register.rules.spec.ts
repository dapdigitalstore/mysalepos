import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCanAccessRegister,
  assertRegisterOpen,
  buildSellPaymentRows,
  canAccessRegister,
  computeRegisterTotals,
  configuredDenominations,
  creditSales,
  customPaymentLabels,
  dayRangeInstants,
  denominationsTotal,
  encodeDenominations,
  floorToMinute,
  netByMethod,
  parseDenominations,
  pickRegisterLocation,
  planRegisterSync,
  reportRowTotals,
  shiftGrandTotal,
  syncAction,
  userDisplayName,
  validateCloseInput,
  validateInitialAmount,
  visiblePaymentTypes,
  type RowByMethodAndType,
  type RowGroup,
} from './cash-register.rules';

const d = (v: string | number) => new Prisma.Decimal(v);
const sell = { id: 10, type: 'sell', status: 'final' };

describe('buildSellPaymentRows', () => {
  it('creates a credit row per non-zero payment with the transaction type', () => {
    const rows = buildSellPaymentRows(sell, [
      { method: 'cash', amount: '1500.50' },
      { method: 'card', amount: 200 },
      { method: 'cash', amount: 0 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ amount: d('1500.5'), pay_method: 'cash', type: 'credit', transaction_type: 'sell', transaction_id: 10 });
    expect(rows[1].pay_method).toBe('card');
    expect(rows[1].amount.toString()).toBe('200');
  });

  it('stores a return (change given back) as a negative credit row', () => {
    const rows = buildSellPaymentRows(sell, [{ method: 'cash', amount: '500' }, { method: 'cash', amount: '120.25', isReturn: true }]);
    expect(rows.map((r) => r.amount.toString())).toEqual(['500', '-120.25']);
    expect(rows[1].type).toBe('credit');
  });

  it('records an expense as a debit', () => {
    const rows = buildSellPaymentRows({ id: 3, type: 'expense' }, [{ method: 'cash', amount: '75' }]);
    expect(rows).toEqual([{ amount: d(75), pay_method: 'cash', type: 'debit', transaction_type: 'expense', transaction_id: 3 }]);
  });

  it('keeps exact decimals and rejects junk', () => {
    const rows = buildSellPaymentRows(sell, [{ method: 'cash', amount: '0.1' }, { method: 'cash', amount: '0.2' }]);
    expect(rows[0].amount.add(rows[1].amount).toString()).toBe('0.3');
    expect(() => buildSellPaymentRows(sell, [{ method: 'cash', amount: 'abc' }])).toThrow(BadRequestException);
  });

  it('rounds to the 4 decimals of the column', () => {
    const rows = buildSellPaymentRows(sell, [{ method: 'cash', amount: '10.123456' }]);
    expect(rows[0].amount.toString()).toBe('10.1235');
  });
});

describe('netByMethod', () => {
  it('subtracts debits from credits per method', () => {
    const rows: RowByMethodAndType[] = [
      { pay_method: 'cash', type: 'credit', amount: d(1000) },
      { pay_method: 'cash', type: 'debit', amount: d(150) },
      { pay_method: 'card', type: 'credit', amount: d(300) },
      { pay_method: null, type: 'credit', amount: d(5) },
    ];
    const net = netByMethod(rows);
    expect(net.cash.toString()).toBe('850');
    expect(net.card.toString()).toBe('300');
    expect(Object.keys(net)).toEqual(['cash', 'card']);
  });
});

describe('syncAction', () => {
  it('follows the three Laravel cases', () => {
    expect(syncAction('draft', 'final')).toBe('add_all');
    expect(syncAction('final', 'draft')).toBe('refund_all');
    expect(syncAction('final', 'final')).toBe('diff');
    expect(syncAction('draft', 'draft')).toBe('none');
    expect(syncAction('final', undefined)).toBe('none');
  });
});

describe('planRegisterSync', () => {
  const prev: RowByMethodAndType[] = [
    { pay_method: 'cash', type: 'credit', amount: d(1000) },
    { pay_method: 'card', type: 'credit', amount: d(500) },
  ];

  it('draft -> final adds every payment', () => {
    const rows = planRegisterSync({ statusBefore: 'draft', transaction: sell, payments: [{ method: 'cash', amount: 700 }], previousRows: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pay_method: 'cash', type: 'credit', transaction_type: 'sell' });
  });

  it('final -> draft refunds what was taken, per method, ignoring zero or negative nets and the advance balance', () => {
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: { ...sell, status: 'draft' },
      payments: [],
      previousRows: [...prev, { pay_method: 'advance', type: 'credit', amount: d(100) }, { pay_method: 'cheque', type: 'credit', amount: d(50) }, { pay_method: 'cheque', type: 'debit', amount: d(50) }],
    });
    expect(rows.map((r) => [r.pay_method, r.amount.toString(), r.type, r.transaction_type])).toEqual([
      ['cash', '1000', 'debit', 'refund'],
      ['card', '500', 'debit', 'refund'],
    ]);
  });

  it('final -> final with the same payments writes nothing', () => {
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: sell,
      payments: [{ method: 'cash', amount: 1000 }, { method: 'card', amount: 500 }],
      previousRows: prev,
    });
    expect(rows).toEqual([]);
  });

  it('final -> final: smaller payment becomes a refund, larger a new sell credit', () => {
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: sell,
      payments: [{ method: 'cash', amount: 800 }, { method: 'card', amount: 650.5 }],
      previousRows: prev,
    });
    expect(rows.map((r) => [r.pay_method, r.amount.toString(), r.type, r.transaction_type])).toEqual([
      ['cash', '200', 'debit', 'refund'],
      ['card', '150.5', 'credit', 'sell'],
    ]);
  });

  it('final -> final: a removed payment method is refunded in full and a new method is added', () => {
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: sell,
      payments: [{ method: 'cash', amount: 1000 }, { method: 'bank_transfer', amount: 500 }],
      previousRows: prev,
    });
    expect(rows.map((r) => [r.pay_method, r.amount.toString(), r.type])).toEqual([
      ['card', '500', 'debit'],
      ['bank_transfer', '500', 'credit'],
    ]);
  });

  it('final -> final: a return line (change) offsets an overpayment', () => {
    // customer handed 1200 cash, 200 change went back: the register must hold 1000 net, which it already does.
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: sell,
      payments: [{ method: 'cash', amount: 1200 }, { method: 'cash', amount: 200, isReturn: true }, { method: 'card', amount: 500 }],
      previousRows: prev,
    });
    expect(rows).toEqual([]);
  });

  it('final -> final: previous refunds are taken into account', () => {
    const rows = planRegisterSync({
      statusBefore: 'final',
      transaction: sell,
      payments: [{ method: 'cash', amount: 900 }],
      previousRows: [
        { pay_method: 'cash', type: 'credit', amount: d(1000) },
        { pay_method: 'cash', type: 'debit', amount: d(100) },
      ],
    });
    expect(rows).toEqual([]);
  });

  it('other transitions do nothing', () => {
    expect(planRegisterSync({ statusBefore: 'draft', transaction: { ...sell, status: 'draft' }, payments: [{ method: 'cash', amount: 5 }], previousRows: prev })).toEqual([]);
  });
});

describe('computeRegisterTotals', () => {
  // Register 38 of the real data: opening 500, cash sales 13,200, refund 1,980 -> closed with 11,720.
  const groups: RowGroup[] = [
    { payMethod: 'cash', transactionType: 'initial', amount: d(500), count: 1 },
    { payMethod: 'cash', transactionType: 'sell', amount: d(13200), count: 12 },
    { payMethod: 'cash', transactionType: 'refund', amount: d(1980), count: 1 },
  ];

  it('matches the figures of a closed register', () => {
    const t = computeRegisterTotals(groups);
    expect(t.cashInHand.toString()).toBe('500');
    expect(t.totalSale.toString()).toBe('11220'); // 13,200 sells minus 1,980 refunds
    expect(t.totalRefund.toString()).toBe('1980');
    expect(t.totalExpense.toString()).toBe('0');
    expect(t.suggestedClosingAmount.toString()).toBe('11720');
    expect(t.totalPayment.toString()).toBe('11720');
    expect(t.expectedTotal.toString()).toBe('11720');
    expect(t.grossSale.toString()).toBe('13200');
  });

  it('splits sales, expenses and refunds per method and counts card slips and cheques', () => {
    const t = computeRegisterTotals([
      { payMethod: 'cash', transactionType: 'initial', amount: d(1000), count: 1 },
      { payMethod: 'cash', transactionType: 'sell', amount: d(5000), count: 4 },
      { payMethod: 'card', transactionType: 'sell', amount: d(2500.75), count: 3 },
      { payMethod: 'cheque', transactionType: 'sell', amount: d(900), count: 2 },
      { payMethod: 'cash', transactionType: 'expense', amount: d(300), count: 1 },
      { payMethod: 'card', transactionType: 'expense', amount: d(50), count: 1 },
      { payMethod: 'card', transactionType: 'refund', amount: d(100.25), count: 1 },
      { payMethod: 'custom_pay_2', transactionType: 'sell', amount: d(40), count: 1 },
    ]);
    const by = Object.fromEntries(t.methods.map((m) => [m.method, m]));
    expect(by.cash.sale.toString()).toBe('5000');
    expect(by.cash.expense.toString()).toBe('300');
    expect(by.card.sale.toString()).toBe('2500.75');
    expect(by.card.refund.toString()).toBe('100.25');
    expect(by.card.expense.toString()).toBe('50');
    expect(by.custom_pay_2.sale.toString()).toBe('40');
    expect(t.cardSlips).toBe(5); // 3 sells + 1 expense + 1 refund paid by card
    expect(t.cheques).toBe(2);
    expect(t.totalSale.toString()).toBe('8340.5'); // 5000+2500.75+900+40-100.25
    expect(t.totalExpense.toString()).toBe('350');
    expect(t.totalPayment.toString()).toBe('6000');
    expect(t.suggestedClosingAmount.toString()).toBe('5700');
    expect(t.expectedTotal.toString()).toBe('8990.5');
  });

  it('negative sell rows (change returned) reduce the sale totals', () => {
    const t = computeRegisterTotals([
      { payMethod: 'cash', transactionType: 'sell', amount: d(1200), count: 1 },
      { payMethod: 'cash', transactionType: 'sell', amount: d(-200), count: 1 },
    ]);
    expect(t.methods[0].sale.toString()).toBe('1000');
    expect(t.totalSale.toString()).toBe('1000');
  });

  it('an empty register is all zero', () => {
    const t = computeRegisterTotals([]);
    expect(t.totalSale.toString()).toBe('0');
    expect(t.methods).toHaveLength(13);
    expect(t.cardSlips).toBe(0);
  });

  it('credit sales are shift sales minus what reached the register', () => {
    expect(creditSales(d(15000), d(11220)).toString()).toBe('3780');
  });
});

describe('register report rows', () => {
  const groups: RowGroup[] = [
    { payMethod: 'cash', transactionType: 'initial', amount: d(500), count: 1 },
    { payMethod: 'cash', transactionType: 'sell', amount: d(1000), count: 2 },
    { payMethod: 'card', transactionType: 'sell', amount: d(250.5), count: 1 },
    { payMethod: 'cash', transactionType: 'refund', amount: d(50), count: 1 },
  ];

  it('sums only sell rows per method and in total', () => {
    const r = reportRowTotals(groups);
    expect(r.methods.cash).toBe('1000');
    expect(r.methods.card).toBe('250.5');
    expect(r.methods.cheque).toBe('0');
    expect(r.total).toBe('1250.5');
  });

  it('keeps exact decimals in the sums', () => {
    const r = reportRowTotals([
      { payMethod: 'cash', transactionType: 'sell', amount: d(0.1), count: 1 },
      { payMethod: 'card', transactionType: 'sell', amount: d(0.2), count: 1 },
    ]);
    expect(r.total).toBe('0.3');
  });
});

describe('shiftGrandTotal', () => {
  it('adds order tax and shipping and subtracts the discount', () => {
    expect(shiftGrandTotal([d(1000), d(250.5)], d(125), d(50.25), d(30)).toString()).toBe('1355.25');
    expect(shiftGrandTotal([], d(0), d(0), d(0)).toString()).toBe('0');
  });
});

describe('opening a register', () => {
  it('accepts zero and positive opening cash, rejects negative or junk', () => {
    expect(validateInitialAmount('1500.5').toString()).toBe('1500.5');
    expect(validateInitialAmount(undefined).toString()).toBe('0');
    expect(() => validateInitialAmount('-1')).toThrow(BadRequestException);
    expect(() => validateInitialAmount('x')).toThrow(BadRequestException);
  });

  it('chooses the only location, or requires a permitted one', () => {
    expect(pickRegisterLocation(undefined, [4])).toBe(4);
    expect(pickRegisterLocation(4, [4])).toBe(4);
    expect(pickRegisterLocation(7, [4, 7])).toBe(7);
    expect(() => pickRegisterLocation(undefined, [4, 7])).toThrow(BadRequestException);
    expect(() => pickRegisterLocation(9, [4, 7])).toThrow(BadRequestException);
    expect(() => pickRegisterLocation(undefined, [])).toThrow(BadRequestException);
  });

  it('cuts the seconds like Laravel (Y-m-d H:i:00)', () => {
    const t = floorToMinute(new Date('2026-10-15T13:53:42.500Z'));
    expect(t.toISOString()).toBe('2026-10-15T13:53:00.000Z');
  });
});

describe('closing a register', () => {
  it('normalises a valid close form', () => {
    const c = validateCloseInput({ closingAmount: '11720', totalCardSlips: 2, totalCheques: 0, closingNote: '  short by 10  ', denominations: { '1000': 11, '500': '1', '100': '', '50': null } });
    expect(c.closing_amount.toString()).toBe('11720');
    expect(c.total_card_slips).toBe(2);
    expect(c.closing_note).toBe('short by 10');
    expect(JSON.parse(c.denominations ?? '{}')).toEqual({ '500': 1, '1000': 11 });
  });

  it('treats an empty note and an uncounted drawer as null', () => {
    const c = validateCloseInput({ closingAmount: 0, totalCardSlips: 0, totalCheques: 0, closingNote: '   ', denominations: { '1000': '' } });
    expect(c.closing_note).toBeNull();
    expect(c.denominations).toBeNull();
    expect(c.closing_amount.isZero()).toBe(true);
  });

  it('rejects negative cash, fractional or negative counts, bad denominations', () => {
    const ok = { closingAmount: '10', totalCardSlips: 0, totalCheques: 0 };
    expect(() => validateCloseInput({ ...ok, closingAmount: '-5' })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, totalCardSlips: -1 })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, totalCheques: 1.5 })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, denominations: { '-100': 1 } })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, denominations: { '100': -2 } })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, denominations: { '100': 1.5 } })).toThrow(BadRequestException);
    expect(() => validateCloseInput({ ...ok, denominations: { abc: 1 } })).toThrow(BadRequestException);
  });

  it('only an open register can be closed', () => {
    expect(() => assertRegisterOpen('open')).not.toThrow();
    expect(() => assertRegisterOpen('close')).toThrow(BadRequestException);
  });
});

describe('denominations', () => {
  it('encodes and parses back, largest note first, with subtotals and a total', () => {
    const json = encodeDenominations({ '100': 3, '1000': 2, '20.50': 4 });
    const rows = parseDenominations(json);
    expect(rows.map((r) => [r.denomination, r.count, r.subtotal])).toEqual([
      ['1000', 2, '2000'],
      ['100', 3, '300'],
      ['20.5', 4, '82'],
    ]);
    expect(denominationsTotal(rows).toString()).toBe('2382');
  });

  it('reads what Laravel saved, including blank counts, and survives bad data', () => {
    const rows = parseDenominations('{"1000":"2","500":"","100":null}');
    expect(rows.map((r) => [r.denomination, r.count, r.subtotal])).toEqual([
      ['1000', 2, '2000'],
      ['500', 0, '0'],
      ['100', 0, '0'],
    ]);
    expect(parseDenominations('not json')).toEqual([]);
    expect(parseDenominations('[1,2]')).toEqual([]);
    expect(parseDenominations(null)).toEqual([]);
  });

  it('reads the configured note values from pos_settings', () => {
    expect(configuredDenominations({ cash_denominations: '100, 1000,500,,100,abc' })).toEqual(['1000', '500', '100']);
    expect(configuredDenominations({ cash_denominations: null })).toEqual([]);
    expect(configuredDenominations(null)).toEqual([]);
  });
});

describe('register access', () => {
  it('own register always; others by location', () => {
    expect(canAccessRegister({ userId: 5, locationId: 1 }, 5, [])).toBe(true);
    expect(canAccessRegister({ userId: 6, locationId: 1 }, 5, 'all')).toBe(true);
    expect(canAccessRegister({ userId: 6, locationId: 1 }, 5, [1, 2])).toBe(true);
    expect(canAccessRegister({ userId: 6, locationId: 3 }, 5, [1, 2])).toBe(false);
    expect(canAccessRegister({ userId: 6, locationId: null }, 5, [1, 2])).toBe(false);
    expect(() => assertCanAccessRegister({ userId: 6, locationId: 3 }, 5, [1])).toThrow(ForbiddenException);
  });
});

describe('helpers', () => {
  it('builds a user name without empty parts', () => {
    expect(userDisplayName({ surname: 'Mr', first_name: 'Nimal', last_name: null })).toBe('Mr Nimal');
    expect(userDisplayName({ surname: ' ', first_name: 'Admin', last_name: 'User' })).toBe('Admin User');
  });

  it('turns a report date range into whole business days', () => {
    const r = dayRangeInstants('2026-10-01', '2026-10-31', 'Asia/Colombo');
    expect(r.from?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.to?.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(dayRangeInstants(undefined, undefined, 'UTC')).toEqual({});
    expect(() => dayRangeInstants('2026-02-30', undefined, 'UTC')).toThrow(BadRequestException);
    expect(() => dayRangeInstants('yesterday', undefined, 'UTC')).toThrow(BadRequestException);
  });

  it('reads custom payment labels and the methods a location enables', () => {
    const labels = customPaymentLabels('{"payments":{"custom_pay_1":"Gift voucher","custom_pay_2":null,"custom_pay_3":" "}}');
    expect(labels).toEqual({ custom_pay_1: 'Gift voucher' });
    expect(customPaymentLabels('oops')).toEqual({});

    const accounts = '{"cash":{"is_enabled":"1"},"custom_pay_1":{"is_enabled":"1"},"custom_pay_2":{"account":null}}';
    const shown = visiblePaymentTypes(labels, accounts, true).map((p) => p.method);
    expect(shown).toContain('cash');
    expect(shown).toContain('advance');
    expect(shown).toContain('custom_pay_1');
    expect(shown).not.toContain('custom_pay_2');
    expect(visiblePaymentTypes(labels, null, false)).toHaveLength(13);
    expect(visiblePaymentTypes(labels, accounts, true).find((p) => p.method === 'custom_pay_1')?.label).toBe('Gift voucher');
  });
});
