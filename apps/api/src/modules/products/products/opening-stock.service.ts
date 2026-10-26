import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { OpeningStockDto, OpeningStockRowDto } from './product.dto';
import { permittedLocationIds, planOpeningStockLine } from './product.rules';
import { openingStockLine, toDecimal } from './pricing.rules';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/**
 * Opening stock of a product, per location and variation (Laravel `OpeningStockController`).
 * Every row is its own transaction of type `opening_stock` with one purchase line; saving also moves
 * `variation_location_details.qty_available` by the difference.
 */
@Injectable()
export class OpeningStockService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser, productId: number) {
    const biz = user.businessId;
    const db = this.prisma.forTenant(biz);
    const product = await db.products.findFirst({
      where: { id: productId },
      include: { product_variations: { include: { variations: { where: { deleted_at: null }, orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.enable_stock) throw new BadRequestException('Stock management is not enabled for this product');

    const [tax, unit, business, locationRows, allLocations, transactions] = await Promise.all([
      product.tax ? db.tax_rates.findFirst({ where: { id: product.tax } }) : null,
      product.unit_id ? db.units.findFirst({ where: { id: product.unit_id } }) : null,
      this.prisma.business.findUnique({ where: { id: biz }, select: { enable_product_expiry: true, enable_lot_number: true } }),
      this.prisma.$queryRaw<{ location_id: bigint | number }[]>`SELECT location_id FROM product_locations WHERE product_id = ${productId}`,
      db.business_locations.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db.transactions.findMany({
        where: { type: 'opening_stock', opening_stock_product_id: productId },
        include: { purchase_lines: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const permitted = permittedLocationIds(user);
    const assigned = new Set(locationRows.map((r) => Number(r.location_id)));
    const locations = allLocations.filter((l) => assigned.has(l.id) && (permitted === null || permitted.includes(l.id)));

    const rows = transactions
      .filter((t) => t.location_id !== null && (permitted === null || permitted.includes(t.location_id)))
      .flatMap((t) =>
        t.purchase_lines.map((pl) => {
          const used = pl.quantity_sold.add(pl.quantity_adjusted).add(pl.quantity_returned).add(pl.mfg_quantity_used);
          return {
            purchase_line_id: pl.id,
            transaction_id: t.id,
            location_id: t.location_id as number,
            variation_id: pl.variation_id,
            quantity: pl.quantity.sub(used).toFixed(),
            used: used.toFixed(),
            purchase_price: pl.purchase_price.toFixed(),
            transaction_date: t.transaction_date,
            note: t.additional_notes,
            exp_date: pl.exp_date,
            lot_number: pl.lot_number,
          };
        }),
      );

    return {
      product: {
        id: product.id,
        name: product.name,
        type: product.type,
        enable_stock: product.enable_stock,
        tax_rate: tax ? String(tax.amount) : '0',
        unit_name: unit?.actual_name ?? null,
        allow_decimal: unit?.allow_decimal ?? false,
      },
      settings: { enableExpiry: business?.enable_product_expiry ?? false, enableLot: business?.enable_lot_number ?? false },
      locations,
      variations: product.product_variations.flatMap((pv) =>
        pv.variations.map((v) => ({ id: v.id, name: pv.is_dummy ? product.name : `${product.name} - ${v.name}`, sub_sku: v.sub_sku, group_name: pv.is_dummy ? null : pv.name })),
      ),
      rows,
    };
  }

  async save(user: AuthUser, productId: number, dto: OpeningStockDto) {
    const biz = user.businessId;
    const db = this.prisma.forTenant(biz);
    const product = await db.products.findFirst({ where: { id: productId }, include: { variations: { where: { deleted_at: null } } } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.enable_stock) throw new BadRequestException('Stock management is not enabled for this product');

    const [tax, locationRows, validLocations] = await Promise.all([
      product.tax ? db.tax_rates.findFirst({ where: { id: product.tax } }) : null,
      this.prisma.$queryRaw<{ location_id: bigint | number }[]>`SELECT location_id FROM product_locations WHERE product_id = ${productId}`,
      db.business_locations.findMany({ where: { deleted_at: null }, select: { id: true } }),
    ]);
    const taxRate = tax ? String(tax.amount) : '0';
    const permitted = permittedLocationIds(user);
    const assigned = new Set(locationRows.map((r) => Number(r.location_id)));
    const valid = new Set(validLocations.map((l) => l.id));
    const variationById = new Map(product.variations.map((v) => [v.id, v]));

    const seen = new Set<number>();
    for (const block of dto.stocks) {
      if (seen.has(block.locationId)) throw new BadRequestException('A location appears twice');
      seen.add(block.locationId);
      if (!valid.has(block.locationId)) throw new BadRequestException('Location not found');
      if (permitted !== null && !permitted.includes(block.locationId)) throw new ForbiddenException('You cannot change stock at a location you have no access to');
      if (!assigned.has(block.locationId)) throw new BadRequestException('The product is not available at this location. Assign the location to the product first');
      for (const row of block.rows) {
        if (!variationById.has(row.variationId)) throw new BadRequestException('A variation does not belong to this product');
        if (toDecimal(row.quantity).isNegative()) throw new BadRequestException('Quantity cannot be negative');
        if (toDecimal(row.purchasePrice).isNegative()) throw new BadRequestException('Purchase price cannot be negative');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const block of dto.stocks) {
        await this.saveLocation(tx, user, product.id, block.locationId, block.rows, taxRate, product.tax, variationById);
      }
    }, TX_OPTIONS);
    return this.get(user, productId);
  }

  private async saveLocation(
    tx: Tx,
    user: AuthUser,
    productId: number,
    locationId: number,
    rows: OpeningStockRowDto[],
    taxRate: string,
    taxId: number | null,
    variationById: Map<number, { id: number; product_variation_id: number }>,
  ) {
    const biz = user.businessId;
    const now = new Date();
    const existing = await tx.transactions.findMany({
      where: { business_id: biz, type: 'opening_stock', opening_stock_product_id: productId, location_id: locationId },
      include: { purchase_lines: true },
    });
    const lineById = new Map(existing.flatMap((t) => t.purchase_lines.map((pl) => [pl.id, { line: pl, transaction: t }] as const)));
    const handled = new Set<number>();

    for (const row of rows) {
      const money = openingStockLine(row.purchasePrice, row.quantity, taxRate);
      const variation = variationById.get(row.variationId);
      if (!variation) continue;
      const expDate = row.expDate ? new Date(row.expDate) : null;
      const lot = row.lotNumber?.trim() || null;
      const note = row.note?.trim() || null;

      if (row.purchaseLineId) {
        const found = lineById.get(row.purchaseLineId);
        if (!found) throw new BadRequestException('An opening stock row was not found. Reload the page and try again');
        if (found.line.variation_id !== row.variationId) throw new BadRequestException('The variation of an existing opening stock row cannot be changed');
        handled.add(found.line.id);
        const pl = found.line;
        const used = pl.quantity_sold.add(pl.quantity_adjusted).add(pl.quantity_returned).add(pl.mfg_quantity_used);
        const plan = planOpeningStockLine({ remaining: row.quantity, used, previousQuantity: pl.quantity });
        if (plan.remove) {
          await this.dropLine(tx, found.transaction.id, pl.id);
          await this.moveStock(tx, productId, variation, locationId, plan.stockDelta);
          continue;
        }
        const total = money.priceIncTax.mul(plan.quantity);
        await tx.purchase_lines.update({
          where: { id: pl.id },
          data: {
            quantity: plan.quantity,
            pp_without_discount: money.purchasePrice,
            purchase_price: money.purchasePrice,
            purchase_price_inc_tax: money.priceIncTax,
            item_tax: money.itemTax,
            tax_id: taxId,
            exp_date: expDate,
            lot_number: lot,
            updated_at: now,
          },
        });
        await tx.transactions.updateMany({
          where: { id: found.transaction.id, business_id: biz },
          data: {
            total_before_tax: total,
            final_total: total,
            transaction_date: row.transactionDate ? new Date(row.transactionDate) : found.transaction.transaction_date,
            additional_notes: note,
            updated_at: now,
          },
        });
        await this.moveStock(tx, productId, variation, locationId, plan.stockDelta);
        await this.linkOversold(tx, biz, productId, row.variationId, locationId, pl.id);
        continue;
      }

      const quantity = toDecimal(row.quantity);
      if (quantity.isZero()) continue;
      const total = money.priceIncTax.mul(quantity);
      const created = await tx.transactions.create({
        data: {
          business_id: biz,
          type: 'opening_stock',
          opening_stock_product_id: productId,
          status: 'received',
          transaction_date: row.transactionDate ? new Date(row.transactionDate) : now,
          additional_notes: note,
          total_before_tax: total,
          final_total: total,
          location_id: locationId,
          payment_status: 'paid',
          essentials_duration: 0,
          created_by: user.id,
          created_at: now,
          updated_at: now,
        },
      });
      const line = await tx.purchase_lines.create({
        data: {
          transaction_id: created.id,
          product_id: productId,
          variation_id: row.variationId,
          quantity,
          pp_without_discount: money.purchasePrice,
          purchase_price: money.purchasePrice,
          purchase_price_inc_tax: money.priceIncTax,
          item_tax: money.itemTax,
          tax_id: taxId,
          exp_date: expDate,
          lot_number: lot,
          created_at: now,
          updated_at: now,
        },
      });
      await this.moveStock(tx, productId, variation, locationId, quantity);
      await this.linkOversold(tx, biz, productId, row.variationId, locationId, line.id);
    }

    // Rows the form no longer has are removed, unless part of the stock was already used.
    for (const [lineId, { line, transaction }] of lineById) {
      if (handled.has(lineId)) continue;
      const used = line.quantity_sold.add(line.quantity_adjusted).add(line.quantity_returned).add(line.mfg_quantity_used);
      if (used.gt(0)) throw new BadRequestException('An opening stock row that was already sold or adjusted cannot be removed. Set its remaining quantity to 0 instead');
      const variation = variationById.get(line.variation_id);
      await this.dropLine(tx, transaction.id, line.id);
      if (variation) await this.moveStock(tx, productId, variation, locationId, line.quantity.neg());
    }
  }

  /** Deletes the purchase line and, when it was the last one, its opening stock transaction. */
  private async dropLine(tx: Tx, transactionId: number, lineId: number) {
    await tx.purchase_lines.delete({ where: { id: lineId } });
    const left = await tx.purchase_lines.count({ where: { transaction_id: transactionId } });
    if (left === 0) await tx.transactions.delete({ where: { id: transactionId } });
  }

  /** `qty_available` of the variation at the location changes by `delta`; the row is created on first use. */
  private async moveStock(tx: Tx, productId: number, variation: { id: number; product_variation_id: number }, locationId: number, delta: Prisma.Decimal) {
    if (delta.isZero()) return;
    const now = new Date();
    const row = await tx.variation_location_details.findFirst({ where: { variation_id: variation.id, product_id: productId, location_id: locationId } });
    if (row) {
      await tx.variation_location_details.update({ where: { id: row.id }, data: { qty_available: row.qty_available.add(delta), updated_at: now } });
    } else {
      await tx.variation_location_details.create({
        data: { product_id: productId, product_variation_id: variation.product_variation_id, variation_id: variation.id, location_id: locationId, qty_available: delta, created_at: now, updated_at: now },
      });
    }
  }

  /**
   * Laravel `adjustStockOverSelling`: sales made while stock was missing are parked on purchase line 0.
   * New stock is matched against them (oldest first) so the sold quantity of the line is right.
   */
  private async linkOversold(tx: Tx, biz: number, productId: number, variationId: number, locationId: number, purchaseLineId: number) {
    const line = await tx.purchase_lines.findUnique({ where: { id: purchaseLineId } });
    if (!line) return;
    let available = line.quantity.sub(line.quantity_sold).sub(line.quantity_adjusted).sub(line.quantity_returned).sub(line.mfg_quantity_used);
    if (!available.gt(0)) return;
    const pending = await tx.$queryRaw<{ id: bigint | number; sell_line_id: bigint | number; quantity: Prisma.Decimal }[]>`
      SELECT tspl.id, tspl.sell_line_id, tspl.quantity
      FROM transaction_sell_lines_purchase_lines tspl
      JOIN transaction_sell_lines tsl ON tsl.id = tspl.sell_line_id
      JOIN transactions t ON t.id = tsl.transaction_id
      WHERE tspl.purchase_line_id = 0 AND t.business_id = ${biz} AND t.location_id = ${locationId}
        AND tsl.variation_id = ${variationId} AND tsl.product_id = ${productId}
      ORDER BY tspl.id`;
    let sold = line.quantity_sold;
    const now = new Date();
    for (const p of pending) {
      if (!available.gt(0)) break;
      const qty = new Prisma.Decimal(p.quantity);
      if (qty.lte(available)) {
        await tx.transaction_sell_lines_purchase_lines.update({ where: { id: BigInt(p.id) }, data: { purchase_line_id: purchaseLineId, updated_at: now } });
        available = available.sub(qty);
        sold = sold.add(qty);
      } else {
        const rest = qty.sub(available);
        await tx.transaction_sell_lines_purchase_lines.update({ where: { id: BigInt(p.id) }, data: { purchase_line_id: purchaseLineId, quantity: available, updated_at: now } });
        await tx.transaction_sell_lines_purchase_lines.create({ data: { sell_line_id: Number(p.sell_line_id), purchase_line_id: 0, quantity: rest, created_at: now, updated_at: now } });
        sold = sold.add(available);
        available = new Prisma.Decimal(0);
      }
    }
    if (!sold.equals(line.quantity_sold)) await tx.purchase_lines.update({ where: { id: purchaseLineId }, data: { quantity_sold: sold, updated_at: now } });
  }
}
