import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/types';
import { SaleNumberingService } from './sale-numbering.service';
import { SalePaymentsService } from './sale-payments.service';
import { SaleStockService } from './sale-stock.service';
import type { SaleDto } from './sale.dto';
import { SalesService } from './sales.service';

/**
 * Orchestration tests of SalesService against a recording fake of the Prisma transaction client. They prove the ORDER and the
 * ARGUMENTS of the writes (stock, FIFO mapping, payments, register hooks, status) and the refusal paths, without any database.
 * The cash register service is mocked, as it is built by another work stream.
 */

const D = (v: string | number) => new Prisma.Decimal(v);
type Handler = (args: Record<string, unknown>) => unknown;
interface Call { op: string; args: Record<string, unknown> }

const user: AuthUser = { id: 7, businessId: 1, username: 'cashier', firstName: 'C', lastName: 'K', language: 'en', isAdmin: true, isSuperadmin: false, permissions: [], timeZone: 'UTC' };

const business = {
  id: 1, time_zone: 'UTC', currency_precision: 2, quantity_precision: 2, accounting_method: 'fifo', sales_cmsn_agnt: null, enable_inline_tax: true, enable_rp: false,
  enable_sub_units: false, enable_product_expiry: false, on_product_expiry: 'keep_selling', stop_selling_before: 0, transaction_edit_days: 30, ref_no_prefixes: '{"draft":"DR","sell_payment":"SP"}',
  enabled_modules: '["account"]', pos_settings: '{}', min_order_total_for_rp: D(1), amount_for_unit_rp: D(1), max_rp_per_order: null, redeem_amount_per_unit_rp: D(1), min_redeem_point: null, max_redeem_point: null,
};
const contact = { id: 3, business_id: 1, is_default: false, credit_limit: null, customer_group_id: null, pay_term_number: null, pay_term_type: null, balance: D(0), total_rp: 0 };
const variation = {
  id: 10, product_id: 100, name: 'DUMMY', sub_sku: 'T1', default_sell_price: D(100), sell_price_inc_tax: D(100), combo_variations: null, product_variation_id: 1,
  products: { id: 100, business_id: 1, name: 'Tea', type: 'single', unit_id: 5, sub_unit_ids: null, tax: null, enable_stock: true, is_inactive: false, warranty_id: null },
};
const unit = { id: 5, allow_decimal: true, base_unit_id: null, base_unit_multiplier: null, short_name: 'pc', actual_name: 'Piece' };

function line(over: Partial<SaleDto['lines'][number]> = {}) {
  return { productId: 100, variationId: 10, quantity: 2, unitPrice: 100, ...over };
}
function sale(over: Partial<SaleDto> = {}): SaleDto {
  return { status: 'final', locationId: 4, contactId: 3, lines: [line()], payments: [{ method: 'cash', amount: 250 }], changeReturn: 50, ...over } as SaleDto;
}

function build(overrides: Record<string, Handler> = {}, registerOpen = true) {
  const calls: Call[] = [];
  const paymentsStore: Array<{ id: number; amount: Prisma.Decimal; is_return: boolean; method: string }> = [];
  let lineSeq = 5000;
  let paymentSeq = 800;
  const defaults: Record<string, Handler> = {
    'business.findUnique': () => business,
    'business_locations.findFirst': () => ({ id: 4, invoice_scheme_id: 1, sale_invoice_scheme_id: null }),
    'contacts.findFirst': () => contact,
    'variations.findMany': () => [variation],
    'units.findMany': () => [unit],
    'tax_rates.findMany': () => [],
    'users.findFirst': () => ({ id: 2 }),
    'transactions.create': () => ({ id: 900 }),
    'transactions.count': () => 0,
    'transactions.findFirst': () => null,
    'transaction_sell_lines.create': () => ({ id: ++lineSeq }),
    'transaction_payments.findMany': () => [...paymentsStore],
    'transaction_payments.update': (a) => {
      const x = a as { where: { id: number }; data: { amount: Prisma.Decimal; method: string; account_id: number | null } };
      return { id: x.where.id, amount: x.data.amount, method: x.data.method, account_id: x.data.account_id ?? null, paid_on: null, is_return: false, created_by: 7 };
    },
    'transaction_payments.create': (a) => {
      const d = (a as { data: { amount: Prisma.Decimal; is_return: boolean; method: string } }).data;
      const row = { id: ++paymentSeq, amount: d.amount, is_return: d.is_return, method: d.method };
      paymentsStore.push(row);
      return row;
    },
    'variation_location_details.findFirst': () => ({ id: 1 }),
    'invoice_schemes.findFirst': () => ({ id: 1 }),
    'products.findMany': () => [{ id: 100, enable_stock: true, name: 'Tea' }],
    'transaction_sell_lines_purchase_lines.groupBy': () => [],
    'transaction_sell_lines_purchase_lines.createMany': () => ({ count: 1 }),
    'cash_register_transactions.deleteMany': () => ({ count: 1 }),
    'accounts.findFirst': () => ({ id: 1 }),
  };
  const raw = (sql: string, values: unknown[]): unknown => {
    calls.push({ op: '$queryRaw', args: { sql, values } });
    if (sql.includes('FROM invoice_schemes')) return [{ id: 1, scheme_type: 'year', number_type: 'sequential', prefix: null, start_number: 1, invoice_count: 1106, total_digits: 4 }];
    if (sql.includes('FROM reference_counts')) return [{ id: 1, ref_count: 5 }];
    if (sql.includes('FROM purchase_lines pl')) return (overrides['$purchaseLines'] ?? (() => [{ purchase_line_id: 77, available: D(10) }]))({}) as unknown[];
    if (sql.includes('FROM transaction_sell_lines_purchase_lines')) return (overrides['$mapping'] ?? (() => []))({}) as unknown[];
    return [];
  };
  const handlers = { ...defaults, ...overrides };
  const tx = new Proxy(
    {},
    {
      get(_t, model: string) {
        if (model === '$queryRaw') return async (strings: TemplateStringsArray, ...values: unknown[]) => raw(strings.join('?'), values);
        if (model === '$executeRaw') return async () => 0;
        return new Proxy({}, {
          get(_m, op: string) {
            return async (args: Record<string, unknown> = {}) => {
              calls.push({ op: `${model}.${op}`, args });
              const h = handlers[`${model}.${op}`];
              return h ? h(args) : null;
            };
          },
        });
      },
    },
  );
  const db = new Proxy(tx, { get: (target, prop) => (prop === '$transaction' ? async (cb: (t: unknown) => Promise<unknown>) => cb(tx) : Reflect.get(target, prop)) });
  const prisma = { forTenant: () => db, business: { findUnique: async () => business } };
  const register = {
    getOpenRegister: jest.fn(async () => (registerOpen ? { id: 9 } : null)),
    addSellPayments: jest.fn(async () => undefined),
    updateSellPayments: jest.fn(async () => undefined),
  };
  const reader = { get: jest.fn(async (_u: AuthUser, id: number) => ({ id })) };
  const numbering = new SaleNumberingService();
  const payments = new SalePaymentsService(prisma as never, numbering);
  const service = new SalesService(prisma as never, new SaleStockService(), numbering, payments, register as never, reader as never);
  const find = (op: string) => calls.filter((c) => c.op === op);
  return { service, payments, register, calls, find, paymentsStore };
}

const fixed = (d: unknown) => (d instanceof Prisma.Decimal ? d.toFixed() : String(d));

describe('SalesService.create', () => {
  it('POS final sale: invoice number, line, payments, stock, FIFO mapping, register rows and payment status, in that order', async () => {
    const t = build();
    await t.service.create(user, sale());

    expect(t.register.getOpenRegister).toHaveBeenCalledTimes(1);
    const header = t.find('transactions.create')[0].args.data as Record<string, unknown>;
    expect(header.status).toBe('final');
    expect(header.invoice_no).toBe('2026-1107'.replace('2026', String(new Date().getUTCFullYear())));
    expect(fixed(header.final_total)).toBe('200');
    expect(fixed(header.total_before_tax)).toBe('200');
    expect(header.is_direct_sale).toBe(false);
    expect(header.created_by).toBe(7);
    expect(t.find('invoice_schemes.update')[0].args.data).toMatchObject({ invoice_count: { increment: 1 } });

    const lineData = t.find('transaction_sell_lines.create')[0].args.data as Record<string, unknown>;
    expect(fixed(lineData.quantity)).toBe('2');
    expect(fixed(lineData.unit_price_inc_tax)).toBe('100');

    // cash 250 received and 50 change given back
    const paid = t.find('transaction_payments.create').map((c) => c.args.data as Record<string, unknown>);
    expect(paid.map((p) => [p.method, fixed(p.amount), p.is_return])).toEqual([['cash', '250', false], ['cash', '50', true]]);
    expect(paid[0].payment_ref_no).toMatch(/^SP\d{4}\/0006$/);

    // stock goes down by 2, mapped from purchase line 77
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(-2) } });
    const map = t.find('transaction_sell_lines_purchase_lines.createMany')[0].args.data as Array<Record<string, unknown>>;
    expect(map.map((m) => [m.purchase_line_id, fixed(m.quantity)])).toEqual([[77, '2']]);
    expect(t.find('purchase_lines.update')[0].args.data).toMatchObject({ quantity_sold: { increment: D(2) } });

    expect(t.register.addSellPayments).toHaveBeenCalledWith(expect.anything(), user, { id: 900, type: 'sell', status: 'final' }, [
      { method: 'cash', amount: '250', isReturn: false },
      { method: 'cash', amount: '50', isReturn: true },
    ]);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'paid' });

    // order: invoice number < header < line < payments < stock < mapping < register
    const order = t.calls.map((c) => c.op);
    const at = (op: string) => order.indexOf(op);
    expect(at('transactions.create')).toBeLessThan(at('transaction_sell_lines.create'));
    expect(at('transaction_sell_lines.create')).toBeLessThan(at('transaction_payments.create'));
    expect(at('transaction_payments.create')).toBeLessThan(at('variation_location_details.update'));
    expect(at('variation_location_details.update')).toBeLessThan(at('transaction_sell_lines_purchase_lines.createMany'));
  });

  it('locks the stock rows and the invoice scheme row (FOR UPDATE) before writing', async () => {
    const t = build();
    await t.service.create(user, sale());
    const raws = t.find('$queryRaw').map((c) => String(c.args.sql));
    expect(raws.some((s) => s.includes('FROM variation_location_details') && s.includes('FOR UPDATE'))).toBe(true);
    expect(raws.some((s) => s.includes('FROM invoice_schemes') && s.includes('FOR UPDATE'))).toBe(true);
    expect(raws.findIndex((s) => s.includes('FROM variation_location_details'))).toBeLessThan(t.calls.findIndex((c) => c.op === 'transactions.create'));
  });

  it('refuses a POS sale when no cash register is open and writes nothing', async () => {
    const t = build({}, false);
    await expect(t.service.create(user, sale())).rejects.toMatchObject({ response: { code: 'REGISTER_NOT_OPEN' } });
    expect(t.find('transactions.create')).toHaveLength(0);
  });

  it('an "Add sale" (direct) sale needs no register and writes no register rows', async () => {
    const t = build({}, false);
    await t.service.create(user, sale({ isDirectSale: true }));
    expect(t.register.getOpenRegister).not.toHaveBeenCalled();
    expect(t.register.addSellPayments).not.toHaveBeenCalled();
    expect(t.find('transaction_sell_lines_purchase_lines.createMany')).toHaveLength(1);
  });

  it('a draft takes no stock, no payments, no mapping and gets a draft reference number', async () => {
    const t = build();
    await t.service.create(user, sale({ status: 'draft' }));
    const header = t.find('transactions.create')[0].args.data as Record<string, unknown>;
    expect(header.status).toBe('draft');
    expect(String(header.invoice_no)).toMatch(/^DR\d{4}\/0006$/);
    expect(t.find('variation_location_details.update')).toHaveLength(0);
    expect(t.find('transaction_payments.create')).toHaveLength(0);
    expect(t.find('transaction_sell_lines_purchase_lines.createMany')).toHaveLength(0);
    expect(t.register.addSellPayments).not.toHaveBeenCalled();
    expect(t.find('invoice_schemes.update')).toHaveLength(0);
  });

  it('a quotation is a draft with sub status quotation and is_quotation set', async () => {
    const t = build();
    await t.service.create(user, sale({ status: 'quotation' }));
    const header = t.find('transactions.create')[0].args.data as Record<string, unknown>;
    expect([header.status, header.sub_status, header.is_quotation]).toEqual(['draft', 'quotation', true]);
  });

  it('a suspended sale is final, takes stock, takes no payment and is "due"', async () => {
    const t = build();
    await t.service.create(user, sale({ isSuspend: true }));
    expect(t.find('transaction_payments.create')).toHaveLength(0);
    expect(t.register.addSellPayments).not.toHaveBeenCalled();
    expect(t.find('variation_location_details.update')).toHaveLength(1);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'due' });
  });

  it('a credit sale ignores the payments sent', async () => {
    const t = build();
    await t.service.create(user, sale({ isCreditSale: true }));
    expect(t.find('transaction_payments.create')).toHaveLength(0);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'due' });
  });

  it('a partial payment leaves the sale partial', async () => {
    const t = build();
    await t.service.create(user, sale({ payments: [{ method: 'cash', amount: 80 }], changeReturn: 0 }));
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'partial' });
  });

  it('computes tax, discount and shipping on the server, ignoring anything the client might claim', async () => {
    const t = build({ 'tax_rates.findMany': () => [{ id: 1, amount: 10 }] });
    await t.service.create(user, sale({ status: 'draft', taxRateId: 1, discountType: 'percentage', discountAmount: 25, shippingCharges: 30, lines: [line({ quantity: 3, unitPrice: 100 })], payments: [] }));
    const header = t.find('transactions.create')[0].args.data as Record<string, unknown>;
    // 300 - 25% = 225 ; +10% tax = 22.5 ; + 30 shipping
    expect(fixed(header.total_before_tax)).toBe('300');
    expect(fixed(header.tax_amount)).toBe('22.5');
    expect(fixed(header.final_total)).toBe('277.5');
    expect(header.discount_type).toBe('percentage');
    expect(fixed(header.discount_amount)).toBe('25');
  });

  it('refuses to sell more than the purchases cover unless overselling is allowed', async () => {
    const short = build({ $purchaseLines: () => [{ purchase_line_id: 77, available: D(1) }] });
    await expect(short.service.create(user, sale())).rejects.toMatchObject({ response: { code: 'PURCHASE_SELL_MISMATCH' } });

    const allowed = build({ $purchaseLines: () => [{ purchase_line_id: 77, available: D(1) }], 'business.findUnique': () => ({ ...business, pos_settings: '{"allow_overselling":"1"}' }) });
    await allowed.service.create(user, sale());
    const map = allowed.find('transaction_sell_lines_purchase_lines.createMany')[0].args.data as Array<Record<string, unknown>>;
    expect(map.map((m) => [m.purchase_line_id, fixed(m.quantity)])).toEqual([[77, '1'], [0, '1']]);
    // only the real purchase line is credited
    expect(allowed.find('purchase_lines.update')).toHaveLength(1);
  });

  it('fills the sale from several purchase lines, oldest first', async () => {
    const t = build({ $purchaseLines: () => [{ purchase_line_id: 70, available: D(1) }, { purchase_line_id: 71, available: D(5) }] });
    await t.service.create(user, sale());
    const map = t.find('transaction_sell_lines_purchase_lines.createMany')[0].args.data as Array<Record<string, unknown>>;
    expect(map.map((m) => [m.purchase_line_id, fixed(m.quantity)])).toEqual([[70, '1'], [71, '1']]);
  });

  it('products without stock tracking never touch stock or mapping', async () => {
    const noStock = { ...variation, products: { ...variation.products, enable_stock: false } };
    const t = build({ 'variations.findMany': () => [noStock] });
    await t.service.create(user, sale());
    expect(t.find('variation_location_details.update')).toHaveLength(0);
    expect(t.find('transaction_sell_lines_purchase_lines.createMany')).toHaveLength(0);
  });

  it('rejects a quantity that is not a whole number for a unit without decimals', async () => {
    const t = build({ 'units.findMany': () => [{ ...unit, allow_decimal: false }] });
    await expect(t.service.create(user, sale({ lines: [line({ quantity: '1.5' })] }))).rejects.toThrow('whole number');
  });

  it('rejects a quantity of 0 and a missing customer', async () => {
    await expect(build().service.create(user, sale({ lines: [line({ quantity: 0 })] }))).rejects.toThrow('greater than 0');
    await expect(build({ 'contacts.findFirst': () => null }).service.create(user, sale())).rejects.toThrow('Customer not found');
  });

  it('refuses a sale that would exceed the customer credit limit', async () => {
    const limited = { ...contact, credit_limit: D(100) };
    const t = build({ 'contacts.findFirst': () => limited });
    // total 200, nothing paid: due 200 > limit 100
    await expect(t.service.create(user, sale({ payments: [], changeReturn: 0 }))).rejects.toMatchObject({ response: { code: 'CREDIT_LIMIT_EXCEEDED' } });
  });

  it('only users with the permission may change the price or give a discount', async () => {
    const cashier: AuthUser = { ...user, isAdmin: false, permissions: ['sell.create', 'location.4'] };
    await expect(build().service.create(cashier, sale({ lines: [line({ unitPrice: 90 })] }))).rejects.toThrow('cannot change the price');
    await expect(build().service.create(cashier, sale({ lines: [line({ lineDiscountType: 'fixed', lineDiscountAmount: 5 })] }))).rejects.toThrow('cannot give a discount');
    await expect(build().service.create(cashier, sale({ discountType: 'fixed', discountAmount: 5 }))).rejects.toThrow('cannot give a discount');
    await expect(build().service.create(cashier, sale({ shippingCharges: 10 }))).rejects.toThrow('shipping');
    // the catalogue price is fine
    await expect(build().service.create(cashier, sale())).resolves.toBeDefined();
  });

  it('refuses a location the user may not use', async () => {
    const cashier: AuthUser = { ...user, isAdmin: false, permissions: ['sell.create', 'location.9'] };
    await expect(build().service.create(cashier, sale())).rejects.toThrow('cannot sell from this location');
  });

  it('advance payments cannot exceed the customer advance balance', async () => {
    await expect(build().service.create(user, sale({ payments: [{ method: 'advance', amount: 100 }], changeReturn: 0 }))).rejects.toMatchObject({ response: { code: 'ADVANCE_BALANCE_NOT_AVAILABLE' } });
    const t = build({ 'contacts.findFirst': () => ({ ...contact, balance: D(500) }) });
    await t.service.create(user, sale({ payments: [{ method: 'advance', amount: 200 }], changeReturn: 0 }));
    expect(t.find('contacts.update')[0].args.data).toMatchObject({ balance: { decrement: D(200) } });
  });

  it('posts a ledger row for a payment that names an account', async () => {
    const t = build();
    await t.service.create(user, sale({ payments: [{ method: 'card', amount: 200, accountId: 5 }], changeReturn: 0 }));
    expect(t.find('account_transactions.create')[0].args.data).toMatchObject({ account_id: 5, type: 'credit', transaction_id: 900 });
  });

  it('combo products sell their components: component rows hold the stock, priced from the combo line', async () => {
    const combo = { ...variation, id: 20, product_id: 200, combo_variations: '[{"variation_id":11,"quantity":2,"unit_id":5}]', products: { ...variation.products, id: 200, type: 'combo', enable_stock: false } };
    const part = { ...variation, id: 11, product_id: 110, sell_price_inc_tax: D(60), products: { ...variation.products, id: 110, name: 'Part' } };
    const t = build({
      'variations.findMany': (a) => ((a as { where: { id: { in: number[] } } }).where.id.in.includes(20) ? [combo] : [part]),
      'products.findMany': () => [{ id: 200, enable_stock: false, name: 'Combo' }, { id: 110, enable_stock: true, name: 'Part' }],
    });
    await t.service.create(user, sale({ status: 'final', isDirectSale: true, payments: [], lines: [{ productId: 200, variationId: 20, quantity: 1, unitPrice: 100 }] }));
    const lines = t.find('transaction_sell_lines.create').map((c) => c.args.data as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ parent_sell_line_id: 5001, children_type: 'combo' });
    expect(fixed(lines[1].quantity)).toBe('2');
    // 2 x 60 = 120 sold for 100 -> each part priced at 50
    expect(fixed(lines[1].unit_price_inc_tax)).toBe('50');
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(-2) } });
  });
});

describe('SalesService.update', () => {
  const before = {
    id: 900, location_id: 4, status: 'final', is_direct_sale: false, invoice_no: 'A-0001', contact_id: 3, transaction_date: new Date(), type: 'sell',
    discount_type: 'percentage', discount_amount: D(0), shipping_charges: D(0), shipping_details: null, shipping_address: null, shipping_status: null, delivered_to: null, delivery_person: null,
    final_total: D(200), rp_earned: 0, rp_redeemed: 0,
  };
  const oldLine = { id: 5001, transaction_id: 900, product_id: 100, variation_id: 10, quantity: D(2), unit_price_before_discount: D(100), line_discount_type: null, line_discount_amount: D(0), children_type: '', parent_sell_line_id: null, lot_no_line_id: null, sub_unit_id: null };

  const base = (extra: Record<string, Handler> = {}) =>
    build({
      'transactions.findFirst': () => before,
      'transaction_sell_lines.findMany': () => [oldLine],
      'transaction_sell_lines_purchase_lines.groupBy': () => [{ sell_line_id: 5001, _sum: { quantity: D(2) } }],
      ...extra,
    });

  it('increasing a final line takes the extra stock and maps only the difference', async () => {
    const t = base();
    await t.service.update(user, 900, sale({ lines: [line({ id: 5001, quantity: 5 })], payments: undefined, changeReturn: undefined }));
    expect(t.find('transaction_sell_lines.update')[0].args.data).toMatchObject({ quantity: D(5) });
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(-3) } });
    const map = t.find('transaction_sell_lines_purchase_lines.createMany')[0].args.data as Array<Record<string, unknown>>;
    expect(map.map((m) => fixed(m.quantity))).toEqual(['3']);
    expect(t.find('transactions.updateMany').some((c) => (c.args.data as Record<string, unknown>).payment_status === 'due' || (c.args.data as Record<string, unknown>).payment_status === 'paid' || (c.args.data as Record<string, unknown>).payment_status === 'partial')).toBe(true);
  });

  it('decreasing a line gives stock back and releases the newest mapping first', async () => {
    const t = base({ $mapping: () => [{ id: 3, purchase_line_id: 77, quantity: D(2) }] });
    await t.service.update(user, 900, sale({ lines: [line({ id: 5001, quantity: 1 })], payments: undefined, changeReturn: undefined }));
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(1) } });
    expect(t.find('transaction_sell_lines_purchase_lines.update')[0].args.data).toMatchObject({ quantity: D(1) });
    expect(t.find('purchase_lines.update')[0].args.data).toMatchObject({ quantity_sold: { decrement: D(1) } });
  });

  it('final -> draft gives all stock back, releases all mapping and tells the register', async () => {
    const t = base({ $mapping: () => [{ id: 3, purchase_line_id: 77, quantity: D(2) }] });
    await t.service.update(user, 900, sale({ status: 'draft', lines: [line({ id: 5001, quantity: 2 })], payments: undefined, changeReturn: undefined }));
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(2) } });
    expect(t.find('transaction_sell_lines_purchase_lines.deleteMany')).toHaveLength(1);
    expect(t.register.updateSellPayments).toHaveBeenCalledWith(expect.anything(), user, 'final', { id: 900, type: 'sell', status: 'draft' }, expect.any(Array));
    // a new draft reference number replaces the invoice number
    expect(String((t.find('transactions.update')[0].args.data as Record<string, unknown>).invoice_no)).toMatch(/^DR\d{4}\/0006$/);
  });

  it('draft -> final takes a new invoice number, the stock and the mapping of every line', async () => {
    const draft = { ...before, status: 'draft' };
    const t = build({
      'transactions.findFirst': () => draft,
      'transaction_sell_lines.findMany': () => [oldLine],
    });
    await t.service.update(user, 900, sale({ status: 'final', lines: [line({ id: 5001, quantity: 2 })] }));
    expect((t.find('transactions.update')[0].args.data as Record<string, unknown>).invoice_no).toBe(`${new Date().getUTCFullYear()}-1107`);
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(-2) } });
    expect(t.find('transaction_sell_lines_purchase_lines.createMany')).toHaveLength(1);
    expect(t.register.updateSellPayments).toHaveBeenCalledWith(expect.anything(), user, 'draft', { id: 900, type: 'sell', status: 'final' }, expect.any(Array));
  });

  it('removing a line returns its stock and mapping; editing is refused after a return or after the edit window', async () => {
    const t = base({ $mapping: () => [{ id: 3, purchase_line_id: 77, quantity: D(2) }] });
    const other = { ...oldLine, id: 5002, product_id: 100, variation_id: 10, quantity: D(1) };
    const t2 = build({
      'transactions.findFirst': () => before,
      'transaction_sell_lines.findMany': () => [oldLine, other],
      'transaction_sell_lines_purchase_lines.groupBy': () => [{ sell_line_id: 5001, _sum: { quantity: D(2) } }, { sell_line_id: 5002, _sum: { quantity: D(1) } }],
      $mapping: () => [{ id: 4, purchase_line_id: 77, quantity: D(1) }],
    });
    await t2.service.update(user, 900, sale({ lines: [line({ id: 5001, quantity: 2 })], payments: undefined, changeReturn: undefined }));
    expect(t2.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(1) } });
    expect(t2.find('transaction_sell_lines.deleteMany')[0].args.where).toMatchObject({ id: { in: [5002] } });

    const returned = base({ 'transactions.count': () => 1 });
    await expect(returned.service.update(user, 900, sale({ lines: [line({ id: 5001 })] }))).rejects.toMatchObject({ response: { code: 'RETURN_EXISTS' } });
    const old = base({ 'transactions.findFirst': () => ({ ...before, transaction_date: new Date('2020-01-01T00:00:00Z') }) });
    await expect(old.service.update(user, 900, sale({ lines: [line({ id: 5001 })] }))).rejects.toMatchObject({ response: { code: 'EDIT_NOT_ALLOWED' } });
    expect(t.find('transactions.update')).toHaveLength(0);
  });

  it('refuses to change the location of a sale and a line that is not part of it', async () => {
    await expect(base().service.update(user, 900, sale({ locationId: 5, lines: [line({ id: 5001 })] }))).rejects.toThrow('location of a sale cannot be changed');
    await expect(base().service.update(user, 900, sale({ lines: [line({ id: 9999 })] }))).rejects.toThrow('does not belong to this sale');
  });

  it('a payments list replaces the existing payments and the register is told the full set', async () => {
    const oldPayment = { id: 810, amount: D(200), is_return: false, method: 'cash', transaction_id: 900, payment_for: 3, parent_id: null };
    const t = base({ 'transaction_payments.findMany': () => [oldPayment] });
    await t.service.update(user, 900, sale({ lines: [line({ id: 5001, quantity: 2 })], payments: [{ id: 810, method: 'card', amount: 120 }, { method: 'cash', amount: 80 }], changeReturn: 0 }));
    expect(t.find('transaction_payments.update')[0].args.data).toMatchObject({ method: 'card', amount: D(120) });
    expect(t.find('transaction_payments.create')).toHaveLength(1);
    expect(t.register.updateSellPayments).toHaveBeenCalledWith(expect.anything(), user, 'final', { id: 900, type: 'sell', status: 'final' }, [
      { method: 'card', amount: '120', isReturn: false },
      { method: 'cash', amount: '80', isReturn: false },
    ]);
  });

  it('a payments list without an existing payment deletes it', async () => {
    const oldPayment = { id: 810, amount: D(200), is_return: false, method: 'cash', transaction_id: 900, payment_for: 3, parent_id: null };
    const t = base({ 'transaction_payments.findMany': () => [oldPayment] });
    await t.service.update(user, 900, sale({ lines: [line({ id: 5001, quantity: 2 })], payments: [{ method: 'cash', amount: 50 }], changeReturn: 0 }));
    expect(t.find('transaction_payments.delete')[0].args.where).toEqual({ id: 810 });
  });
});

describe('SalesService.remove', () => {
  const final = { id: 900, location_id: 4, status: 'final', contact_id: 3, rp_earned: 0, rp_redeemed: 0, type: 'sell' };
  const oldLine = { id: 5001, product_id: 100, variation_id: 10, quantity: D(2), children_type: '', parent_sell_line_id: null };

  it('a final sale gives stock back, releases the mapping, drops register rows and payments, then deletes the sale', async () => {
    const pay = { id: 810, amount: D(200), method: 'advance', payment_for: 3, parent_id: null };
    const t = build({
      'transactions.findFirst': () => final,
      'transaction_sell_lines.findMany': () => [oldLine],
      'transaction_sell_lines_purchase_lines.groupBy': () => [{ sell_line_id: 5001, _sum: { quantity: D(2) } }],
      'transaction_payments.findMany': () => [pay],
      $mapping: () => [{ id: 3, purchase_line_id: 77, quantity: D(2) }],
    });
    await expect(t.service.remove(user, 900)).resolves.toEqual({ success: true });
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(2) } });
    expect(t.find('purchase_lines.update')[0].args.data).toMatchObject({ quantity_sold: { decrement: D(2) } });
    expect(t.find('cash_register_transactions.deleteMany')[0].args.where).toEqual({ transaction_id: 900 });
    expect(t.find('contacts.update')[0].args.data).toMatchObject({ balance: { increment: D(200) } });
    expect(t.find('transactions.delete')[0].args.where).toEqual({ id: 900 });
    const ops = t.calls.map((c) => c.op);
    expect(ops.indexOf('variation_location_details.update')).toBeLessThan(ops.indexOf('transactions.delete'));
  });

  it('a draft is deleted without touching stock', async () => {
    const t = build({ 'transactions.findFirst': () => ({ ...final, status: 'draft' }), 'transaction_sell_lines.findMany': () => [oldLine] });
    await t.service.remove(user, 900);
    expect(t.find('variation_location_details.update')).toHaveLength(0);
    expect(t.find('transactions.delete')).toHaveLength(1);
  });

  it('a sale with a return cannot be deleted', async () => {
    const t = build({ 'transactions.findFirst': () => final, 'transactions.count': () => 1 });
    await expect(t.service.remove(user, 900)).rejects.toMatchObject({ response: { code: 'RETURN_EXISTS' } });
    expect(t.find('transactions.delete')).toHaveLength(0);
  });
});

describe('SalesService.convertToInvoice', () => {
  const draft = { id: 900, location_id: 4, status: 'draft', contact_id: 3, is_direct_sale: false, final_total: D(200), type: 'sell' };
  const oldLine = { id: 5001, product_id: 100, variation_id: 10, quantity: D(2), children_type: '', parent_sell_line_id: null, lot_no_line_id: null };

  it('gives the draft an invoice number, takes stock, maps it and sets the payment status', async () => {
    const t = build({ 'transactions.findFirst': () => draft, 'transaction_sell_lines.findMany': () => [oldLine] });
    await t.service.convertToInvoice(user, 900);
    expect(t.find('transactions.update')[0].args.data).toMatchObject({ status: 'final', sub_status: null, is_quotation: false, invoice_no: `${new Date().getUTCFullYear()}-1107` });
    expect(t.find('variation_location_details.update')[0].args.data).toMatchObject({ qty_available: { increment: D(-2) } });
    expect(t.find('transaction_sell_lines_purchase_lines.createMany')).toHaveLength(1);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'due' });
    expect(t.register.getOpenRegister).toHaveBeenCalled();
  });

  it('refuses when the stock is not there', async () => {
    const t = build({ 'transactions.findFirst': () => draft, 'transaction_sell_lines.findMany': () => [oldLine], $purchaseLines: () => [] });
    await expect(t.service.convertToInvoice(user, 900)).rejects.toMatchObject({ response: { code: 'PURCHASE_SELL_MISMATCH' } });
  });
});

describe('SalePaymentsService (payments on an existing sale)', () => {
  const finalSale = { id: 900, type: 'sell', status: 'final', contact_id: 3, final_total: D(200), payment_status: 'due', location_id: 4, invoice_no: 'X-1' };
  const existing = { id: 810, transaction_id: 900, method: 'cash', amount: D(100), is_return: false, payment_for: 3, parent_id: null, account_id: 5, paid_on: new Date(), created_by: 7 };
  const base = (extra: Record<string, Handler> = {}) =>
    build({ 'transactions.findFirst': () => finalSale, 'transaction_payments.findFirst': () => existing, ...extra });

  it('adds a payment, numbers it and moves the sale to partial', async () => {
    const t = base();
    await t.payments.add(user, 900, { method: 'cash', amount: 80, note: 'deposit' });
    const row = t.find('transaction_payments.create')[0].args.data as Record<string, unknown>;
    expect([row.method, fixed(row.amount), row.is_return, row.note, row.transaction_id]).toEqual(['cash', '80', false, 'deposit', 900]);
    expect(row.payment_ref_no).toMatch(/^SP\d{4}\/0006$/);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'partial' });
  });

  it('refuses more than the due amount, a paid sale and a draft', async () => {
    const t = base({ 'transaction_payments.findMany': () => [{ amount: D(150), is_return: false }] });
    await expect(t.payments.add(user, 900, { method: 'cash', amount: 51 })).rejects.toMatchObject({ response: { code: 'PAYMENT_EXCEEDS_DUE' } });
    const paid = base({ 'transaction_payments.findMany': () => [{ amount: D(200), is_return: false }] });
    await expect(paid.payments.add(user, 900, { method: 'cash', amount: 1 })).rejects.toMatchObject({ response: { code: 'ALREADY_PAID' } });
    const draft = base({ 'transactions.findFirst': () => ({ ...finalSale, status: 'draft' }) });
    await expect(draft.payments.add(user, 900, { method: 'cash', amount: 1 })).rejects.toThrow('final sale');
    await expect(base().payments.add(user, 900, { method: 'bitcoin', amount: 1 })).rejects.toThrow('Unknown payment method');
  });

  it('edits a payment: omitted detail fields stay, the status is recalculated', async () => {
    // first read = the other payments (none), later reads = the payments after the edit
    let reads = 0;
    const t = base({ 'transaction_payments.findMany': () => (reads++ === 0 ? [] : [{ amount: D(200), is_return: false }]) });
    await t.payments.update(user, 810, { method: 'card', amount: 200, cardNumber: '4111' });
    const data = t.find('transaction_payments.update')[0].args.data as Record<string, unknown>;
    expect(data).toMatchObject({ method: 'card', card_number: '4111' });
    expect('account_id' in data).toBe(false);
    expect('note' in data).toBe(false);
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'paid' });
  });

  it('will not edit a payment up past the invoice total', async () => {
    const t = base({ 'transaction_payments.findMany': () => [{ amount: D(150), is_return: false }] });
    await expect(t.payments.update(user, 810, { method: 'cash', amount: 250 })).rejects.toMatchObject({ response: { code: 'PAYMENT_EXCEEDS_DUE' } });
  });

  it('deletes a payment, returns advance money and recalculates the status', async () => {
    const adv = { ...existing, method: 'advance', amount: D(100), account_id: null };
    const t = base({ 'transaction_payments.findFirst': () => adv, 'transaction_payments.findMany': () => [] });
    await t.payments.remove(user, 810);
    expect(t.find('transaction_payments.delete')[0].args.where).toEqual({ id: 810 });
    expect(t.find('contacts.update')[0].args.data).toMatchObject({ balance: { increment: D(100) } });
    expect(t.find('account_transactions.updateMany')[0].args.where).toMatchObject({ transaction_payment_id: 810 });
    expect(t.find('transactions.updateMany')[0].args.data).toMatchObject({ payment_status: 'due' });
  });

  it('paying from the advance balance needs enough advance', async () => {
    const t = base({ 'transaction_payments.findMany': () => [] });
    await expect(t.payments.add(user, 900, { method: 'advance', amount: 50 })).rejects.toMatchObject({ response: { code: 'ADVANCE_BALANCE_NOT_AVAILABLE' } });
  });

  it('does not find sales of another business or a missing payment', async () => {
    await expect(build({ 'transactions.findFirst': () => null }).payments.add(user, 1, { method: 'cash', amount: 1 })).rejects.toThrow('Sale not found');
    await expect(build({ 'transaction_payments.findFirst': () => null }).payments.remove(user, 1)).rejects.toThrow('Payment not found');
  });
});
