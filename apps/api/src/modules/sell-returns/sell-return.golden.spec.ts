import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { applyMappingPlan, computeReturnTotals, normalizeDiscount, planMappingChange, type SellPurchaseMapping } from './sell-return.rules';

/**
 * Golden data copied (read-only SELECTs) from the real database `dapdigitalit_pos2026`.
 *
 * The database holds NO `sell_return` transactions (no sale was ever returned), so stored return totals cannot be compared.
 * A sell return is priced with the same function as a sale (`calculateInvoiceTotal`), so the check below returns every line of
 * every real final sale in full, with the sale's own discount and tax (which is exactly what Laravel pre-fills in the return
 * form), and requires the result to equal the stored `total_before_tax`, `tax_amount` and `final_total` of that sale.
 *
 * __fixtures__/golden-sales.json   [{ id, bid, dt: discount_type, da: discount_amount, tax: tax rate %, tbt, ta, ft, extras, lines: [[qty, unit_price_inc_tax]] }]
 * __fixtures__/golden-mappings.json  sell lines with their FIFO rows (all multi row lines + a sample of single row lines)
 */
interface GoldenSale {
  id: number;
  bid: number;
  dt: string;
  da: string;
  tax: string;
  tbt: string;
  ta: string;
  ft: string;
  extras: string;
  lines: [string, string][];
}

interface GoldenLine {
  sellLineId: number;
  lineQty: string;
  maps: [number, number, string, string][];
}

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as T;
const sales = fixture<GoldenSale[]>('golden-sales.json');
const mappingLines = fixture<GoldenLine[]>('golden-mappings.json');

describe('golden: full return of every real sale reproduces its stored totals', () => {
  it('has the expected amount of data', () => {
    expect(sales.length).toBeGreaterThan(1000);
    expect(sales.some((s) => s.dt === 'percentage' && s.tax !== '0')).toBe(true);
  });

  it('total_before_tax, tax_amount and final_total match for all sales', () => {
    const mismatches: string[] = [];
    for (const s of sales) {
      // sales with shipping, round off, packing or extra expenses are priced by the sales engine, not by a return
      if (s.extras !== '0') continue;
      const t = computeReturnTotals(
        s.lines.map(([q, p]) => ({ quantity: new Prisma.Decimal(q), unitPriceIncTax: new Prisma.Decimal(p) })),
        normalizeDiscount(s.dt, s.da),
        s.tax,
      );
      const got = [t.totalBeforeTax, t.tax, t.finalTotal].map((d) => d.toFixed());
      const want = [s.tbt, s.ta, s.ft].map((v) => new Prisma.Decimal(v).toFixed());
      if (got.join('|') !== want.join('|')) mismatches.push(`sale ${s.id}: got ${got.join(' / ')} want ${want.join(' / ')}`);
    }
    // Sale 896 (invoice 0754) is inconsistent in the source data itself: its lines add up to 3600, tax 360 matches, but the stored
    // final_total is 4180 instead of 3960 (the customer paid 4180). Every other sale matches to the 4th decimal.
    expect(mismatches).toEqual(['sale 896: got 3600 / 360 / 3960 want 3600 / 360 / 4180']);
  });

  it('compares every sale (none has shipping, round off, packing or extra expenses)', () => {
    expect(sales.filter((s) => s.extras === '0').length).toBe(sales.length);
  });
});

describe('golden: FIFO mapping rows of real sell lines', () => {
  const toMappings = (g: GoldenLine): SellPurchaseMapping[] =>
    g.maps.map(([id, pl, q, r]) => ({ id, purchaseLineId: pl, quantity: new Prisma.Decimal(q), qtyReturned: new Prisma.Decimal(r) }));

  it('the mapping quantities add up to the quantity sold', () => {
    for (const g of mappingLines) {
      const sum = toMappings(g).reduce((s, m) => s.add(m.quantity), new Prisma.Decimal(0));
      expect(sum.toFixed()).toBe(new Prisma.Decimal(g.lineQty).toFixed());
    }
  });

  it('returning a whole sell line is absorbed completely and un-returning restores the start', () => {
    for (const g of mappingLines) {
      const start = toMappings(g);
      const qty = new Prisma.Decimal(g.lineQty);
      const up = planMappingChange(start, qty);
      expect(up.unallocated.toFixed()).toBe('0');
      const mid = applyMappingPlan(start, up);
      expect(mid.reduce((s, m) => s.add(m.qtyReturned), new Prisma.Decimal(0)).toFixed()).toBe(qty.toFixed());
      const soldDelta = up.updates.reduce((s, u) => s.add(u.quantitySoldDelta), new Prisma.Decimal(0));
      expect(soldDelta.toFixed()).toBe(qty.neg().toFixed());
      const down = planMappingChange(mid, qty.neg());
      expect(down.unallocated.toFixed()).toBe('0');
      expect(applyMappingPlan(mid, down).map((m) => m.qtyReturned.toFixed())).toEqual(start.map((m) => m.qtyReturned.toFixed()));
    }
  });

  it('covers lines fed from several purchase lots', () => {
    expect(mappingLines.some((g) => g.maps.length > 1)).toBe(true);
  });
});
