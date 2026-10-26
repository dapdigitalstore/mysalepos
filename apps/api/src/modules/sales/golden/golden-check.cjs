/**
 * Golden data check of the sales rules against the sales Laravel stored (READ-ONLY SELECTs, nothing is written).
 *
 *   cd apps/api && node src/modules/sales/golden/golden-check.cjs
 *
 * It compiles sale.rules.ts to a temp folder, loads every `sell` transaction with its lines and payments from the database in
 * DATABASE_URL (or ../../.env) and recomputes, with the same rules the API uses:
 *   line:   unit_price, unit_price_inc_tax, item_tax
 *   header: total_before_tax, tax_amount, final_total (= parts + stored round_off_amount), payment_status
 * then prints the match rate per field and every mismatch pattern. Not a jest test on purpose: unit tests never touch the DB.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const apiRoot = path.resolve(__dirname, '../../../..');
process.env.NODE_PATH = path.join(apiRoot, 'node_modules');
require('module').Module._initPaths();
if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync(path.resolve(apiRoot, '../../.env'), 'utf8');
  process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-golden-'));
execSync(
  `npx tsc src/modules/sales/sale.rules.ts --outDir "${out}" --module commonjs --target es2022 --esModuleInterop --skipLibCheck --experimentalDecorators --emitDecoratorMetadata`,
  { cwd: apiRoot, stdio: 'inherit' },
);
const R = require(path.join(out, 'modules/sales/sale.rules.js'));
const { Prisma, PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const D = (v) => new Prisma.Decimal(v ?? 0);
const eq = (a, b, tol = '0.0001') => D(a).sub(D(b)).abs().lte(D(tol));
const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
};

(async () => {
  const tx = await prisma.$queryRawUnsafe(
    "select id, business_id, status, payment_status, total_before_tax, tax_id, tax_amount, discount_type, discount_amount, final_total, shipping_charges, round_off_amount, additional_expense_value_1 a1, additional_expense_value_2 a2, additional_expense_value_3 a3, additional_expense_value_4 a4, packing_charge, packing_charge_type, rp_redeemed_amount from transactions where type='sell'",
  );
  const lines = await prisma.$queryRawUnsafe(
    "select l.id, l.transaction_id, l.quantity, l.unit_price_before_discount upbd, l.unit_price, l.line_discount_type ldt, l.line_discount_amount lda, l.item_tax, l.tax_id, l.unit_price_inc_tax upit, l.sub_unit_id, l.parent_sell_line_id from transaction_sell_lines l join transactions t on t.id=l.transaction_id where t.type='sell'",
  );
  const pays = await prisma.$queryRawUnsafe(
    "select p.transaction_id, p.amount, p.is_return from transaction_payments p join transactions t on t.id=p.transaction_id where t.type='sell'",
  );
  const taxes = new Map((await prisma.$queryRawUnsafe('select id, amount from tax_rates')).map((t) => [Number(t.id), t.amount]));
  const units = new Map((await prisma.$queryRawUnsafe('select id, base_unit_multiplier from units')).map((u) => [Number(u.id), u.base_unit_multiplier]));
  const prec = new Map((await prisma.$queryRawUnsafe('select id, currency_precision from business')).map((b) => [Number(b.id), Number(b.currency_precision)]));
  const linesBy = group(lines.map((l) => ({ ...l, transaction_id: Number(l.transaction_id) })), 'transaction_id');
  const paysBy = group(pays.map((p) => ({ ...p, transaction_id: Number(p.transaction_id) })), 'transaction_id');

  const checks = ['line.unit_price', 'line.unit_price_inc_tax', 'line.item_tax', 'header.total_before_tax', 'header.tax_amount', 'header.final_total', 'header.payment_status'];
  const ok = Object.fromEntries(checks.map((c) => [c, 0]));
  const total = Object.fromEntries(checks.map((c) => [c, 0]));
  const mismatches = {};
  const check = (name, pass, detail) => {
    total[name]++;
    if (pass) ok[name]++;
    else (mismatches[name] = mismatches[name] || []).push(detail);
  };

  for (const t of tx) {
    const id = Number(t.id);
    const p = prec.get(Number(t.business_id)) ?? 2;
    const own = (linesBy.get(id) ?? []).filter((l) => !l.parent_sell_line_id);
    const lineTotals = [];
    for (const l of own) {
      const m = l.sub_unit_id && units.get(Number(l.sub_unit_id)) ? D(units.get(Number(l.sub_unit_id))) : D(1);
      const rate = l.tax_id ? taxes.get(Number(l.tax_id)) ?? 0 : 0;
      const calc = R.calculateLine(
        { quantity: D(l.quantity).div(m), unitPrice: D(l.upbd).mul(m), discountType: l.ldt, discountAmount: l.ldt === 'fixed' ? D(l.lda).mul(m) : l.lda, taxRate: rate, multiplier: m },
        p,
      );
      check('line.unit_price', eq(calc.stored.unit_price, l.unit_price), { sale: id, line: Number(l.id), mine: calc.stored.unit_price.toFixed(), stored: String(l.unit_price) });
      check('line.unit_price_inc_tax', eq(calc.stored.unit_price_inc_tax, l.upit), { sale: id, line: Number(l.id), mine: calc.stored.unit_price_inc_tax.toFixed(), stored: String(l.upit) });
      check('line.item_tax', eq(calc.stored.item_tax, l.item_tax), { sale: id, line: Number(l.id), mine: calc.stored.item_tax.toFixed(), stored: String(l.item_tax) });
      lineTotals.push(D(l.quantity).mul(D(l.upit)));
    }
    const rate = t.tax_id ? taxes.get(Number(t.tax_id)) ?? 0 : 0;
    const r = R.calculateInvoiceTotals({
      lineTotals,
      discountType: t.discount_type,
      discountAmount: t.discount_amount,
      taxRate: rate,
      shippingCharges: t.shipping_charges,
      additionalExpenses: [t.a1, t.a2, t.a3, t.a4],
      packingCharge: t.packing_charge,
      packingChargeType: t.packing_charge_type,
      rpRedeemedAmount: t.rp_redeemed_amount,
      precision: p,
    });
    check('header.total_before_tax', eq(r.totalBeforeTax, t.total_before_tax), { sale: id, mine: r.totalBeforeTax.toFixed(), stored: String(t.total_before_tax) });
    // Laravel stores the order tax computed WITHOUT the redeemed reward amount; the API subtracts it (documented difference)
    const laravelTax = D(rate).div(100).mul(D(t.total_before_tax).sub(r.discountValue));
    check('header.tax_amount', eq(r.taxAmount, t.tax_amount) || (D(t.rp_redeemed_amount).gt(0) && eq(laravelTax, t.tax_amount)), { sale: id, mine: r.taxAmount.toFixed(), stored: String(t.tax_amount) });
    const expectedFinal = r.totalPayable.add(D(t.round_off_amount));
    check('header.final_total', eq(R.round4(expectedFinal), t.final_total, '0.005'), { sale: id, status: t.status, mine: expectedFinal.toFixed(4), stored: String(t.final_total) });
    if (t.status === 'final') {
      const paid = R.totalPaid((paysBy.get(id) ?? []).map((x) => ({ amount: x.amount, isReturn: x.is_return })));
      const status = R.paymentStatus(t.final_total, paid);
      check('header.payment_status', status === t.payment_status, { sale: id, mine: status, stored: t.payment_status, finalTotal: String(t.final_total), paid: paid.toFixed() });
    }
  }
  console.log(`sell transactions: ${tx.length}, lines: ${lines.length}, payments: ${pays.length}`);
  for (const c of checks) console.log(c.padEnd(28), `${ok[c]}/${total[c]}`.padEnd(12), total[c] ? `${((100 * ok[c]) / total[c]).toFixed(2)}%` : '');
  for (const [k, v] of Object.entries(mismatches)) console.log('MISMATCH', k, v.length, JSON.stringify(v.slice(0, 5)));
  await prisma.$disconnect();
  fs.rmSync(out, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
