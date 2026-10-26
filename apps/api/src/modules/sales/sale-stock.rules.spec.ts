import { Prisma } from '@prisma/client';
import {
  allocateFromPurchases,
  heldStock,
  mappingChange,
  mergeDecrements,
  planRelease,
  resolveUncovered,
  stockDeltas,
  stopSellingCutoff,
  wantedMapping,
  type StockLine,
} from './sale-stock.rules';

const D = (v: string | number) => new Prisma.Decimal(v);
const line = (variationId: number, quantity: number, enableStock = true): StockLine => ({ productId: variationId * 10, variationId, quantity: D(quantity), enableStock });
const deltas = (...args: Parameters<typeof stockDeltas>) => stockDeltas(...args).map((d) => [d.variationId, d.delta.toFixed()]);

describe('stockDeltas (Laravel transitions)', () => {
  it('draft -> draft never moves stock', () => {
    expect(deltas('draft', [line(1, 2)], 'draft', [line(1, 5)])).toEqual([]);
  });

  it('new final sale takes stock', () => {
    expect(deltas('draft', [], 'final', [line(1, 3), line(2, 1)])).toEqual([[1, '-3'], [2, '-1']]);
  });

  it('draft -> final takes the stock of every line', () => {
    expect(deltas('draft', [line(1, 4)], 'final', [line(1, 4), line(2, 2)])).toEqual([[1, '-4'], [2, '-2']]);
  });

  it('final -> draft gives all stock back, including lines removed in the same edit', () => {
    expect(deltas('final', [line(1, 4), line(2, 2)], 'draft', [line(1, 1)])).toEqual([[1, '4'], [2, '2']]);
  });

  it('final -> final: quantity change, new line and removed line', () => {
    // v1 5 -> 8 (-3), v2 removed (+2), v3 new 1 (-1)
    expect(deltas('final', [line(1, 5), line(2, 2)], 'final', [line(1, 8), line(3, 1)])).toEqual([[1, '-3'], [2, '2'], [3, '-1']]);
  });

  it('final -> final with the same quantities changes nothing', () => {
    expect(deltas('final', [line(1, 5)], 'final', [line(1, 5)])).toEqual([]);
  });

  it('the same variation on two lines is combined', () => {
    expect(deltas('draft', [], 'final', [line(1, 2), line(1, 3)])).toEqual([[1, '-5']]);
  });

  it('products without stock tracking never move stock', () => {
    expect(deltas('draft', [], 'final', [line(1, 2, false)])).toEqual([]);
    expect(heldStock('final', [line(1, 2, false), line(2, 1)])).toHaveLength(1);
  });

  it('deleting a final sale (no lines after) restores everything', () => {
    expect(deltas('final', [line(1, 2)], 'draft', [])).toEqual([[1, '2']]);
  });

  it('a combo sells its components: component lines hold stock like any line', () => {
    expect(deltas('draft', [], 'final', [line(1, 1, false), line(7, 2), line(8, 1)])).toEqual([[7, '-2'], [8, '-1']]);
  });

  it('keeps decimals exact', () => {
    expect(deltas('draft', [], 'final', [{ productId: 1, variationId: 1, quantity: D('0.1'), enableStock: true }, { productId: 1, variationId: 1, quantity: D('0.2'), enableStock: true }])).toEqual([[1, '-0.3']]);
  });
});

describe('mapping', () => {
  it('wants the full line mapped only while final and tracked', () => {
    expect(wantedMapping('final', true, D(3)).toFixed()).toBe('3');
    expect(wantedMapping('draft', true, D(3)).toFixed()).toBe('0');
    expect(wantedMapping('final', false, D(3)).toFixed()).toBe('0');
  });

  it('turns the gap into an allocation or a release', () => {
    expect(mappingChange(D(5), D(0))).toEqual({ kind: 'allocate', quantity: D(5) });
    expect(mappingChange(D(5), D(3))).toEqual({ kind: 'allocate', quantity: D(2) });
    expect(mappingChange(D(2), D(5))).toEqual({ kind: 'release', quantity: D(3) });
    expect(mappingChange(D(0), D(5))).toEqual({ kind: 'release', quantity: D(5) });
    expect(mappingChange(D(4), D(4))).toEqual({ kind: 'none' });
  });
});

describe('allocateFromPurchases (FIFO)', () => {
  const rows = [
    { purchaseLineId: 1, available: D(3) },
    { purchaseLineId: 2, available: D(5) },
    { purchaseLineId: 3, available: D(10) },
  ];

  it('takes from the oldest purchase line first', () => {
    const r = allocateFromPurchases(D(2), rows);
    expect(r.allocations).toEqual([{ purchaseLineId: 1, quantity: D(2) }]);
    expect(r.remaining.toFixed()).toBe('0');
  });

  it('spills over to the next lines', () => {
    const r = allocateFromPurchases(D(9), rows);
    expect(r.allocations.map((a) => [a.purchaseLineId, a.quantity.toFixed()])).toEqual([[1, '3'], [2, '5'], [3, '1']]);
    expect(r.remaining.toFixed()).toBe('0');
  });

  it('reports what is not covered', () => {
    const r = allocateFromPurchases(D(20), rows);
    expect(r.allocations).toHaveLength(3);
    expect(r.remaining.toFixed()).toBe('2');
  });

  it('skips exhausted lines and handles no rows', () => {
    expect(allocateFromPurchases(D(1), [{ purchaseLineId: 1, available: D(0) }, { purchaseLineId: 2, available: D(1) }]).allocations).toEqual([{ purchaseLineId: 2, quantity: D(1) }]);
    expect(allocateFromPurchases(D(4), []).remaining.toFixed()).toBe('4');
  });

  it('works with fractions', () => {
    const r = allocateFromPurchases(D('1.5'), [{ purchaseLineId: 1, available: D('0.75') }, { purchaseLineId: 2, available: D(2) }]);
    expect(r.allocations.map((a) => a.quantity.toFixed())).toEqual(['0.75', '0.75']);
  });
});

describe('resolveUncovered (overselling)', () => {
  it('refuses the sale when overselling is off', () => {
    expect(() => resolveUncovered(D(2), false, 'Tea SKU: T1')).toThrow('Not enough stock to sell Tea SKU: T1. Quantity: 2');
  });
  it('maps the rest to purchase line 0 when overselling is allowed', () => {
    expect(resolveUncovered(D(2), true, 'x')).toEqual({ purchaseLineId: 0, quantity: D(2) });
  });
  it('does nothing when everything was covered', () => {
    expect(resolveUncovered(D(0), false, 'x')).toBeNull();
  });
});

describe('planRelease', () => {
  const rows = [
    { id: 30, purchaseLineId: 3, quantity: D(2) },
    { id: 20, purchaseLineId: 2, quantity: D(4) },
    { id: 10, purchaseLineId: 1, quantity: D(3) },
  ];

  it('takes from the newest rows first and trims a partly released row', () => {
    const p = planRelease(rows, D(1));
    expect(p.updates).toEqual([{ id: 30, quantity: D(1) }]);
    expect(p.deletes).toEqual([]);
    expect(p.purchaseLineDecrements).toEqual([{ purchaseLineId: 3, quantity: D(1) }]);
  });

  it('deletes fully released rows and credits each purchase line with what was taken', () => {
    const p = planRelease(rows, D(5));
    expect(p.deletes).toEqual([30]);
    expect(p.updates).toEqual([{ id: 20, quantity: D(1) }]);
    expect(p.purchaseLineDecrements).toEqual([{ purchaseLineId: 3, quantity: D(2) }, { purchaseLineId: 2, quantity: D(3) }]);
  });

  it('releasing everything empties the mapping', () => {
    const p = planRelease(rows, D(9));
    expect(p.deletes).toEqual([30, 20, 10]);
    expect(p.updates).toEqual([]);
  });

  it('oversold rows (purchase line 0) have nothing to credit', () => {
    const p = planRelease([{ id: 5, purchaseLineId: 0, quantity: D(2) }], D(2));
    expect(p.deletes).toEqual([5]);
    expect(p.purchaseLineDecrements).toEqual([]);
  });

  it('merges repeated purchase lines', () => {
    expect(mergeDecrements([{ purchaseLineId: 1, quantity: D(1) }, { purchaseLineId: 1, quantity: D(2) }, { purchaseLineId: 2, quantity: D(1) }])).toEqual([
      { purchaseLineId: 1, quantity: D(3) },
      { purchaseLineId: 2, quantity: D(1) },
    ]);
  });
});

describe('stopSellingCutoff', () => {
  it('is today plus the stop-selling days', () => {
    expect(stopSellingCutoff(new Date('2026-03-30T15:20:00Z'), 5).toISOString().slice(0, 10)).toBe('2026-04-04');
  });
});
