import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, ZERO } from './sale.rules';

/**
 * Pure stock and FIFO mapping rules of a sale, ported from Laravel
 * (`ProductUtil::decreaseProductQuantity`, `TransactionUtil::mapPurchaseSell`, `adjustMappingPurchaseSell`, `mapDecrementPurchaseQuantity`).
 *
 * Two ideas replace Laravel's per-transition code, with the same result for every Draft/Final transition:
 *  - stock: a sale only holds stock while it is `final`. The change of `qty_available` is (stock held before) - (stock held after).
 *  - mapping: each final line must be mapped to purchase lines for exactly its quantity. The difference between the wanted and the
 *    current mapped quantity is allocated (FIFO/LIFO) or released.
 */

export type Dec = Prisma.Decimal;

export interface StockLine {
  productId: number;
  variationId: number;
  /** Quantity in the product's base unit. */
  quantity: Dec;
  /** products.enable_stock; lines of products without stock tracking never move stock. */
  enableStock: boolean;
}

/** Lines that hold stock for a sale in this status. */
export function heldStock(status: string, lines: StockLine[]): StockLine[] {
  return status === 'final' ? lines.filter((l) => l.enableStock) : [];
}

export interface StockDelta {
  productId: number;
  variationId: number;
  /** Amount to ADD to variation_location_details.qty_available (negative when the sale takes more stock). */
  delta: Dec;
}

/** Net change of qty_available per variation when a sale goes from (statusBefore, linesBefore) to (statusAfter, linesAfter). */
export function stockDeltas(statusBefore: string, linesBefore: StockLine[], statusAfter: string, linesAfter: StockLine[]): StockDelta[] {
  const map = new Map<string, StockDelta>();
  const add = (l: StockLine, sign: 1 | -1) => {
    const key = `${l.productId}:${l.variationId}`;
    const cur = map.get(key) ?? { productId: l.productId, variationId: l.variationId, delta: ZERO };
    cur.delta = cur.delta.add(sign === 1 ? l.quantity : l.quantity.neg());
    map.set(key, cur);
  };
  for (const l of heldStock(statusBefore, linesBefore)) add(l, 1);
  for (const l of heldStock(statusAfter, linesAfter)) add(l, -1);
  return [...map.values()].filter((d) => !d.delta.isZero()).sort((a, b) => a.variationId - b.variationId);
}

/** How much of a line must be mapped to purchases: everything while the sale is final (and the product tracks stock), nothing otherwise. */
export function wantedMapping(status: string, enableStock: boolean, lineQuantity: Dec): Dec {
  return status === 'final' && enableStock ? lineQuantity : ZERO;
}

export type MappingChange = { kind: 'none' } | { kind: 'allocate'; quantity: Dec } | { kind: 'release'; quantity: Dec };

/** What to do for a line whose wanted mapped quantity differs from what is mapped now. */
export function mappingChange(wanted: Dec, current: Dec): MappingChange {
  const diff = wanted.sub(current);
  if (diff.gt(0)) return { kind: 'allocate', quantity: diff };
  if (diff.lt(0)) return { kind: 'release', quantity: diff.neg() };
  return { kind: 'none' };
}

// ------------------------------------------------------------------------------------------------ FIFO allocation

export interface PurchaseAvailability {
  purchaseLineId: number;
  /** purchase_lines.quantity - (quantity_sold + quantity_adjusted + quantity_returned + mfg_quantity_used) */
  available: Dec;
}

export interface Allocation {
  purchaseLineId: number;
  quantity: Dec;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Quantity no purchase line could cover. */
  remaining: Dec;
}

/** `mapPurchaseSell` inner loop: takes from the purchase lines in the given order (FIFO or LIFO is decided by the query order). */
export function allocateFromPurchases(quantity: Dec, rows: PurchaseAvailability[]): AllocationResult {
  let selling = quantity;
  const allocations: Allocation[] = [];
  for (const row of rows) {
    if (selling.lte(0)) break;
    const allocated = selling.lte(row.available) ? selling : row.available;
    selling = selling.sub(allocated);
    if (!allocated.isZero()) allocations.push({ purchaseLineId: row.purchaseLineId, quantity: allocated });
    if (selling.isZero()) break;
  }
  return { allocations, remaining: selling.lt(0) ? ZERO : selling };
}

/** The mapping row used when overselling is allowed: it points at no purchase line (purchase_line_id = 0). */
export const OVERSOLD_PURCHASE_LINE_ID = 0;

/**
 * What to do with the quantity that no purchase line covers: refuse the sale, or (pos_settings.allow_overselling) keep it
 * unmapped with purchase_line_id 0 so a later purchase can adjust it (`adjustStockOverSelling`).
 */
export function resolveUncovered(remaining: Dec, allowOverselling: boolean, productLabel: string): Allocation | null {
  if (remaining.isZero() || remaining.lt(0)) return null;
  if (!allowOverselling) {
    throw new BadRequestException({
      message: `Not enough stock to sell ${productLabel}. Quantity: ${remaining.toFixed()}`,
      code: 'PURCHASE_SELL_MISMATCH',
    });
  }
  return { purchaseLineId: OVERSOLD_PURCHASE_LINE_ID, quantity: remaining };
}

// ------------------------------------------------------------------------------------------------ release

export interface MappingRow {
  id: number;
  /** 0 for quantity that was oversold. */
  purchaseLineId: number;
  quantity: Dec;
}

export interface ReleasePlan {
  updates: Array<{ id: number; quantity: Dec }>;
  deletes: number[];
  /** Quantity to take back from purchase_lines.quantity_sold. */
  purchaseLineDecrements: Array<{ purchaseLineId: number; quantity: Dec }>;
}

/**
 * `mapDecrementPurchaseQuantity`: releases `decrement` from the newest mapping rows first. Unlike Laravel, the purchase line is
 * always credited with exactly the quantity taken from the row (Laravel credits the whole remaining decrement when it deletes a row).
 */
export function planRelease(rowsNewestFirst: MappingRow[], decrement: Dec): ReleasePlan {
  const plan: ReleasePlan = { updates: [], deletes: [], purchaseLineDecrements: [] };
  let remaining = decrement;
  for (const row of rowsNewestFirst) {
    if (remaining.lte(0)) break;
    const take = remaining.lt(row.quantity) ? remaining : row.quantity;
    if (row.purchaseLineId !== OVERSOLD_PURCHASE_LINE_ID) plan.purchaseLineDecrements.push({ purchaseLineId: row.purchaseLineId, quantity: take });
    if (take.eq(row.quantity)) plan.deletes.push(row.id);
    else plan.updates.push({ id: row.id, quantity: row.quantity.sub(take) });
    remaining = remaining.sub(take);
  }
  return plan;
}

/** Sums repeated purchase line ids so each purchase line is updated once. */
export function mergeDecrements(items: Array<{ purchaseLineId: number; quantity: Dec }>): Array<{ purchaseLineId: number; quantity: Dec }> {
  const map = new Map<number, Dec>();
  for (const i of items) map.set(i.purchaseLineId, (map.get(i.purchaseLineId) ?? ZERO).add(i.quantity));
  return [...map.entries()].map(([purchaseLineId, quantity]) => ({ purchaseLineId, quantity }));
}

// ------------------------------------------------------------------------------------------------ expiry

/** `stop_selling` expiry rule: purchase lines expiring on or before today + stop_selling_before days cannot be sold from. */
export function stopSellingCutoff(today: Date, stopSellingBeforeDays: number): Date {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + stopSellingBeforeDays);
  return d;
}

/** Helper for tests and the service: quantities arrive as decimal strings from raw queries. */
export function qty(v: Prisma.Decimal | string | number | null | undefined): Dec {
  return dec(v as string | number | Prisma.Decimal | null | undefined);
}
