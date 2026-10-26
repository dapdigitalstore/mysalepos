import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../../common/can';
import type { AuthUser } from '../../../common/types';
import { toDecimal } from './pricing.rules';

/** Business rules of the product catalogue that do not need the database. */

export type SkuType = 'with_variation' | 'with_out_variation';
export type StockStatus = 'not_tracked' | 'out_of_stock' | 'low_stock' | 'in_stock';

/** Laravel `ProductUtil::generateProductSku`: business SKU prefix + product id padded to 4 digits. */
export function generateProductSku(prefix: string | null | undefined, productId: number): string {
  return `${prefix ?? ''}${String(productId).padStart(4, '0')}`;
}

/**
 * Laravel `ProductUtil::generateSubSku`.
 *  - `with_out_variation` (default in the form): SKU + running number, `SKU-1` for Code 128 / Code 39 barcodes.
 *  - `with_variation`: SKU + the variation value without spaces or symbols (`SKUBlue`).
 * An empty value would give a SKU identical to the product SKU, so the running number is used instead.
 */
export function generateSubSku(sku: string, counter: number, barcodeType: string | null | undefined, valueName: string, skuType: SkuType | undefined): string {
  if (skuType === 'with_variation') {
    const cleaned = valueName.replace(/[^a-zA-Z0-9]/g, '');
    if (cleaned) return `${sku}${cleaned}`;
  }
  return barcodeType === 'C128' || barcodeType === 'C39' ? `${sku}-${counter}` : `${sku}${counter}`;
}

/** First value that appears twice (case-insensitive, trimmed); null when all are unique. */
export function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (seen.has(key)) return v;
    seen.add(key);
  }
  return null;
}

/** `sub_unit_ids` is stored as a JSON array of id strings (what Laravel's array cast writes). */
export function serializeSubUnitIds(ids: number[] | undefined | null): string | null {
  if (!ids || ids.length === 0) return null;
  return JSON.stringify([...new Set(ids)].map(String));
}

export function parseSubUnitIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

export interface StoredComboLine {
  variation_id: number;
  quantity: number;
  unit_id: number | null;
}

/** `combo_variations` is JSON text, `[]` for non combo products. Tolerates strings for numbers (Laravel stored them). */
export function parseComboVariations(raw: string | null | undefined): StoredComboLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredComboLine[] = [];
    for (const row of parsed as Record<string, unknown>[]) {
      const variationId = Number(row.variation_id);
      if (!Number.isInteger(variationId) || variationId <= 0) continue;
      const unit = Number(row.unit_id);
      out.push({ variation_id: variationId, quantity: Number(row.quantity) || 0, unit_id: Number.isInteger(unit) && unit > 0 ? unit : null });
    }
    return out;
  } catch {
    return [];
  }
}

/** Locations the user may see: `null` = all (Laravel `permitted_locations() == 'all'`), otherwise the `location.<id>` permissions. */
export function permittedLocationIds(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>): number[] | null {
  if (can(user, 'access_all_locations')) return null;
  return user.permissions
    .filter((p) => p.startsWith('location.'))
    .map((p) => Number(p.slice('location.'.length)))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Stock state of a product as the list shows it. `qty` is the summed quantity over the visible locations. */
export function stockStatus(input: { enableStock: boolean; qty: Prisma.Decimal.Value | null | undefined; alertQuantity: Prisma.Decimal.Value | null | undefined }): StockStatus {
  if (!input.enableStock) return 'not_tracked';
  const qty = toDecimal(input.qty as string | number);
  if (!qty.gt(0)) return 'out_of_stock';
  if (input.alertQuantity !== null && input.alertQuantity !== undefined && qty.lte(toDecimal(input.alertQuantity as string | number))) return 'low_stock';
  return 'in_stock';
}

/** Escapes LIKE wildcards so a search term is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ProductUsage {
  enableStock: boolean;
  /** Purchase lines of real purchases (transaction type `purchase`). */
  purchaseLines: number;
  /** Opening stock purchase lines that were partly sold. */
  soldOpeningStockLines: number;
  /** Purchase lines (any transaction) that were used by a stock adjustment. */
  adjustedLines: number;
  /** Any sell line of the product. */
  sellLines: number;
  /** Any stock adjustment line of the product. */
  stockAdjustmentLines: number;
}

/**
 * Laravel `ProductController::destroy`: a product with purchases, sold or adjusted opening stock cannot be deleted.
 * Stricter than Laravel on purpose: Laravel only looks at sell lines for products without stock tracking, but the
 * database cascades a product delete to its sell lines, so any sale blocks deletion here.
 * Returns the reason, or null when the product may be deleted.
 */
export function productDeletionBlocker(u: ProductUsage): string | null {
  if (u.purchaseLines > 0) return 'This product has purchases and cannot be deleted. Mark it inactive instead';
  if (u.soldOpeningStockLines > 0) return 'Part of the opening stock of this product was sold, so it cannot be deleted. Mark it inactive instead';
  if (u.adjustedLines > 0 || u.stockAdjustmentLines > 0) return 'Stock of this product was adjusted, so it cannot be deleted. Mark it inactive instead';
  if (u.sellLines > 0) return 'This product has sales and cannot be deleted. Mark it inactive instead';
  return null;
}

export interface VariationUsage {
  purchaseLines: number;
  sellLines: number;
  stockAdjustmentLines: number;
}

/** A variation that was ever bought, sold or adjusted must stay (its history points at it). */
export function variationRemovalBlocker(u: VariationUsage): string | null {
  if (u.purchaseLines > 0 || u.sellLines > 0 || u.stockAdjustmentLines > 0) {
    return 'A variation that has stock or sales history cannot be removed';
  }
  return null;
}

export interface OpeningStockInput {
  /** Quantity still in stock, as the form shows it (total quantity minus what was used). */
  remaining: Prisma.Decimal.Value;
  /** Quantity already sold, adjusted, returned or used in manufacturing from this line. */
  used: Prisma.Decimal.Value;
  /** Total quantity currently on the stored line (0 when the line is new). */
  previousQuantity: Prisma.Decimal.Value;
}

export interface OpeningStockPlan {
  /** New total quantity of the purchase line. */
  quantity: Prisma.Decimal;
  /** Change to apply to `qty_available` of the variation at the location. */
  stockDelta: Prisma.Decimal;
  /** True when the line should be dropped (nothing left and nothing ever used). */
  remove: boolean;
}

/**
 * Laravel `OpeningStockController::save`: the form edits the remaining quantity, the stored line keeps
 * remaining + used. Stock moves by the difference between the new and old stored quantity.
 */
export function planOpeningStockLine(i: OpeningStockInput): OpeningStockPlan {
  const remaining = toDecimal(i.remaining as string | number);
  if (remaining.isNegative()) throw new BadRequestException('Opening stock quantity cannot be negative');
  const used = toDecimal(i.used as string | number);
  const quantity = remaining.add(used);
  const previous = toDecimal(i.previousQuantity as string | number);
  return { quantity, stockDelta: quantity.sub(previous), remove: quantity.isZero() };
}

export interface ProductShapeInput {
  type: 'single' | 'variable' | 'combo';
  enableStock?: boolean;
  expiryPeriod?: number | null;
  expiryPeriodType?: string | null;
  comboItemCount?: number;
  variationGroups?: { name: string; variations: { name: string }[] }[];
  /** On update the combo items / variation groups may be left out to mean "keep as they are". */
  partial?: boolean;
}

/** Type specific checks that class-validator cannot express. Throws BadRequest with a readable message. */
export function assertProductShape(p: ProductShapeInput): void {
  if (p.type === 'combo' && !(p.partial && p.comboItemCount === undefined) && !(p.comboItemCount && p.comboItemCount > 0)) {
    throw new BadRequestException('A combo product needs at least one product in its composition');
  }
  if (p.type === 'variable' && !(p.partial && p.variationGroups === undefined)) {
    const groups = p.variationGroups ?? [];
    if (groups.length === 0) throw new BadRequestException('A variable product needs at least one variation');
    const dupGroup = firstDuplicate(groups.map((g) => g.name));
    if (dupGroup) throw new BadRequestException(`Variation "${dupGroup}" is used twice`);
    for (const g of groups) {
      if (g.variations.length === 0) throw new BadRequestException(`Variation "${g.name}" needs at least one value`);
      const dupValue = firstDuplicate(g.variations.map((v) => v.name));
      if (dupValue) throw new BadRequestException(`Value "${dupValue}" is used twice in "${g.name}"`);
    }
  }
  if ((p.expiryPeriod || p.expiryPeriodType) && !p.enableStock) {
    throw new BadRequestException('Expiry period needs stock management to be enabled');
  }
  if (p.expiryPeriod && !p.expiryPeriodType) throw new BadRequestException('Choose the expiry period type');
}
