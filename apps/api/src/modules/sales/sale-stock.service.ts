import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantTx } from '../../common/tenant-db';
import {
  allocateFromPurchases,
  mappingChange,
  mergeDecrements,
  OVERSOLD_PURCHASE_LINE_ID,
  planRelease,
  qty,
  resolveUncovered,
  type Dec,
  type MappingRow,
  type StockDelta,
} from './sale-stock.rules';

export interface MappingContext {
  businessId: number;
  locationId: number;
  accountingMethod: 'fifo' | 'lifo';
  allowOverselling: boolean;
  /** Purchase lines expiring on or before this day (YYYY-MM-DD) cannot be sold from (on_product_expiry = stop_selling). */
  stopSellingCutoff: string | null;
}

export interface MappableLine {
  id: number;
  productId: number;
  variationId: number;
  lotNoLineId: number | null;
  label: string;
}

interface AvailabilityRow {
  purchase_line_id: bigint | number;
  available: Prisma.Decimal | string | number;
}

interface MappingRowRaw {
  id: bigint | number;
  purchase_line_id: bigint | number;
  quantity: Prisma.Decimal | string | number;
}

/** Database side of the stock rules: row locks, qty_available changes and purchase/sell line mapping (all inside the caller's transaction). */
@Injectable()
export class SaleStockService {
  /** `SELECT ... FOR UPDATE` on the stock rows of the variations, always in id order so two sales never deadlock. */
  async lockStock(tx: TenantTx, locationId: number, variationIds: number[]): Promise<void> {
    const ids = [...new Set(variationIds)];
    if (ids.length === 0) return;
    await tx.$queryRaw`SELECT id FROM variation_location_details WHERE location_id = ${locationId} AND variation_id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  }

  /** Adds each delta to qty_available (creating the stock row of a location that never had the product, like decreaseProductQuantity). */
  async applyDeltas(tx: TenantTx, locationId: number, deltas: StockDelta[]): Promise<void> {
    const now = new Date();
    for (const d of deltas) {
      const row = await tx.variation_location_details.findFirst({
        where: { variation_id: d.variationId, product_id: d.productId, location_id: locationId },
        select: { id: true },
      });
      if (row) {
        await tx.variation_location_details.update({ where: { id: row.id }, data: { qty_available: { increment: d.delta }, updated_at: now } });
      } else {
        const variation = await tx.variations.findUnique({ where: { id: d.variationId }, select: { product_variation_id: true } });
        await tx.variation_location_details.create({
          data: {
            product_id: d.productId,
            variation_id: d.variationId,
            location_id: locationId,
            product_variation_id: variation?.product_variation_id ?? 0,
            qty_available: d.delta,
            created_at: now,
            updated_at: now,
          },
        });
      }
    }
  }

  /** Quantity currently mapped to purchase lines, per sell line. */
  async mappedQuantities(tx: TenantTx, sellLineIds: number[]): Promise<Map<number, Dec>> {
    const out = new Map<number, Dec>();
    if (sellLineIds.length === 0) return out;
    const rows = await tx.transaction_sell_lines_purchase_lines.groupBy({ by: ['sell_line_id'], where: { sell_line_id: { in: sellLineIds } }, _sum: { quantity: true } });
    for (const r of rows) if (r.sell_line_id !== null) out.set(r.sell_line_id, qty(r._sum.quantity));
    return out;
  }

  /**
   * Brings the mapping of one sell line to `wanted` (the whole line quantity while the sale is final and the product tracks
   * stock, else 0): allocates more from the purchases (FIFO or LIFO) or releases the surplus.
   */
  async reconcile(tx: TenantTx, ctx: MappingContext, line: MappableLine, wanted: Dec, current: Dec): Promise<void> {
    const change = mappingChange(wanted, current);
    if (change.kind === 'allocate') await this.allocate(tx, ctx, line, change.quantity);
    else if (change.kind === 'release') await this.release(tx, line.id, change.quantity);
  }

  /** `mapPurchaseSell` for one line. Throws a 400 (PURCHASE_SELL_MISMATCH) when the stock is not there and overselling is not allowed. */
  async allocate(tx: TenantTx, ctx: MappingContext, line: MappableLine, quantity: Dec): Promise<void> {
    const order = ctx.accountingMethod === 'lifo' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const expiry = ctx.stopSellingCutoff ? Prisma.sql`AND (pl.exp_date IS NULL OR pl.exp_date > ${ctx.stopSellingCutoff})` : Prisma.empty;
    const lot = line.lotNoLineId ? Prisma.sql`AND pl.id = ${line.lotNoLineId}` : Prisma.empty;
    const rows = await tx.$queryRaw<AvailabilityRow[]>`
      SELECT pl.id AS purchase_line_id,
             (pl.quantity - (pl.quantity_sold + pl.quantity_adjusted + pl.quantity_returned + pl.mfg_quantity_used)) AS available
      FROM purchase_lines pl
      JOIN transactions t ON t.id = pl.transaction_id
      WHERE t.business_id = ${ctx.businessId}
        AND t.location_id = ${ctx.locationId}
        AND t.type IN ('purchase', 'purchase_transfer', 'opening_stock', 'production_purchase')
        AND t.status = 'received'
        AND (pl.quantity_sold + pl.quantity_adjusted + pl.quantity_returned + pl.mfg_quantity_used) < pl.quantity
        AND pl.product_id = ${line.productId}
        AND pl.variation_id = ${line.variationId}
        ${expiry}
        ${lot}
      ORDER BY t.transaction_date ${order}, pl.id ${order}
      FOR UPDATE`;
    const result = allocateFromPurchases(
      quantity,
      rows.map((r) => ({ purchaseLineId: Number(r.purchase_line_id), available: qty(r.available) })),
    );
    const allocations = [...result.allocations];
    const rest = resolveUncovered(result.remaining, ctx.allowOverselling, line.label);
    if (rest) allocations.push(rest);

    const now = new Date();
    if (allocations.length > 0) {
      await tx.transaction_sell_lines_purchase_lines.createMany({
        data: allocations.map((a) => ({ sell_line_id: line.id, purchase_line_id: a.purchaseLineId, quantity: a.quantity, created_at: now, updated_at: now })),
      });
    }
    for (const a of allocations) {
      if (a.purchaseLineId === OVERSOLD_PURCHASE_LINE_ID) continue;
      await tx.purchase_lines.update({ where: { id: a.purchaseLineId }, data: { quantity_sold: { increment: a.quantity }, updated_at: now } });
    }
  }

  /** `mapDecrementPurchaseQuantity`: takes `quantity` back from the newest mapping rows of the sell line and from the purchase lines' quantity_sold. */
  async release(tx: TenantTx, sellLineId: number, quantity: Dec): Promise<void> {
    const rows = await tx.$queryRaw<MappingRowRaw[]>`
      SELECT id, purchase_line_id, quantity FROM transaction_sell_lines_purchase_lines WHERE sell_line_id = ${sellLineId} ORDER BY id DESC FOR UPDATE`;
    const mapping: MappingRow[] = rows.map((r) => ({ id: Number(r.id), purchaseLineId: Number(r.purchase_line_id), quantity: qty(r.quantity) }));
    const plan = planRelease(mapping, quantity);
    const now = new Date();
    for (const u of plan.updates) {
      await tx.transaction_sell_lines_purchase_lines.update({ where: { id: BigInt(u.id) }, data: { quantity: u.quantity, updated_at: now } });
    }
    if (plan.deletes.length > 0) {
      await tx.transaction_sell_lines_purchase_lines.deleteMany({ where: { id: { in: plan.deletes.map((id) => BigInt(id)) } } });
    }
    for (const d of mergeDecrements(plan.purchaseLineDecrements)) {
      await tx.purchase_lines.update({ where: { id: d.purchaseLineId }, data: { quantity_sold: { decrement: d.quantity }, updated_at: now } });
    }
  }
}
