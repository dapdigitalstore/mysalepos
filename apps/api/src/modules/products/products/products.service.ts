import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../../common/can';
import { paginated } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  BulkActionDto,
  CheckSkuQueryDto,
  ComboItemDto,
  GroupPricesDto,
  ProductDto,
  ProductListQueryDto,
  SearchQueryDto,
  VariationGroupDto,
  VariationValueDto,
} from './product.dto';
import {
  assertProductShape,
  escapeLike,
  firstDuplicate,
  generateProductSku,
  generateSubSku,
  parseComboVariations,
  parseSubUnitIds,
  permittedLocationIds,
  productDeletionBlocker,
  serializeSubUnitIds,
  stockStatus,
  variationRemovalBlocker,
} from './product.rules';
import { calculateVariationPrices, comboPurchaseTotal, groupPrice, type PriceInput, type TaxType, toDecimal } from './pricing.rules';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

const LIST_SORT: Record<string, string> = {
  name: 'p.name',
  sku: 'p.sku',
  id: 'p.id',
  type: 'p.type',
  category: 'c1.name',
  brand: 'b.name',
  unit: 'u.short_name',
  current_stock: 'COALESCE(agg.stock, 0)',
  selling_price: 'agg.min_price',
  purchase_price: 'agg.min_purchase_price',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
};

interface ListRow {
  id: bigint | number;
  name: string;
  type: string;
  sku: string;
  image: string | null;
  enable_stock: number | boolean;
  is_inactive: number | boolean;
  not_for_selling: number | boolean;
  alert_quantity: Prisma.Decimal | string | null;
  unit: string | null;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  tax_name: string | null;
  stock: Prisma.Decimal | string | null;
  min_price: Prisma.Decimal | string | null;
  max_price: Prisma.Decimal | string | null;
  min_purchase_price: Prisma.Decimal | string | null;
  max_purchase_price: Prisma.Decimal | string | null;
  variation_count: bigint | number;
  updated_at: Date | null;
}

interface SearchRow {
  product_id: bigint | number;
  name: string;
  type: string;
  enable_stock: number | boolean;
  variation_id: bigint | number;
  variation: string;
  sub_sku: string | null;
  sku: string;
  unit: string | null;
  unit_id: bigint | number | null;
  purchase_price: Prisma.Decimal | string | null;
  qty_available: Prisma.Decimal | string | null;
  selling_price: Prisma.Decimal | string | null;
  group_price: Prisma.Decimal | string | null;
  group_price_type: string | null;
}

const bool = (v: unknown) => v === true || v === 1 || v === 1n || v === '1';
const dec = (v: Prisma.Decimal | string | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toFixed());

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ meta

  /** Business settings the product screens need, plus what this user may see. */
  async formMeta(user: AuthUser) {
    const b = await this.prisma.business.findUnique({ where: { id: user.businessId } });
    if (!b) throw new NotFoundException('Business not found');
    return {
      defaultProfitPercent: b.default_profit_percent,
      skuPrefix: b.sku_prefix ?? '',
      enableProductExpiry: b.enable_product_expiry,
      enableLotNumber: b.enable_lot_number,
      enableBrand: b.enable_brand,
      enableCategory: b.enable_category,
      enableSubCategory: b.enable_sub_category,
      enablePriceTax: b.enable_price_tax,
      enableSubUnits: b.enable_sub_units,
      currencyPrecision: b.currency_precision,
      quantityPrecision: b.quantity_precision,
      permittedLocationIds: permittedLocationIds(user),
      canViewPurchasePrice: can(user, 'view_purchase_price'),
    };
  }

  /** The unit itself (multiplier 1) and its sub-units, for the sub-unit and combo pickers. */
  async subUnits(user: AuthUser, unitId: number) {
    const db = this.prisma.forTenant(user.businessId);
    const unit = await db.units.findFirst({ where: { id: unitId, deleted_at: null } });
    if (!unit) throw new NotFoundException('Unit not found');
    const subs = await db.units.findMany({ where: { base_unit_id: unitId, deleted_at: null }, orderBy: { actual_name: 'asc' } });
    return [
      { id: unit.id, label: unit.actual_name, multiplier: '1', allowDecimal: unit.allow_decimal },
      ...subs.map((s) => ({ id: s.id, label: s.actual_name, multiplier: String(s.base_unit_multiplier ?? 1), allowDecimal: s.allow_decimal })),
    ];
  }

  // ------------------------------------------------------------------ list

  async list(user: AuthUser, q: ProductListQueryDto) {
    const biz = user.businessId;
    const permitted = permittedLocationIds(user);
    const showPurchase = can(user, 'view_purchase_price');
    const locationNone = q.locationId === 'none';
    const locationId = q.locationId && !locationNone ? Number(q.locationId) : null;
    if (q.locationId && !locationNone && !(Number.isInteger(locationId) && (locationId as number) > 0)) {
      throw new BadRequestException('Invalid location');
    }
    if (locationId !== null && permitted !== null && !permitted.includes(locationId)) throw new ForbiddenException('You cannot see this location');

    // Locations whose stock is summed in the list.
    let stockLocations: Prisma.Sql;
    if (locationId !== null) stockLocations = Prisma.sql`AND vld.location_id = ${locationId}`;
    else if (permitted === null) stockLocations = Prisma.empty;
    else if (permitted.length === 0) stockLocations = Prisma.sql`AND 1 = 0`;
    else stockLocations = Prisma.sql`AND vld.location_id IN (${Prisma.join(permitted)})`;

    const where: Prisma.Sql[] = [Prisma.sql`p.business_id = ${biz}`, Prisma.sql`p.type <> 'modifier'`];
    if (q.type) where.push(Prisma.sql`p.type = ${q.type}`);
    if (q.categoryId) where.push(Prisma.sql`p.category_id = ${q.categoryId}`);
    if (q.subCategoryId) where.push(Prisma.sql`p.sub_category_id = ${q.subCategoryId}`);
    if (q.brandId) where.push(Prisma.sql`p.brand_id = ${q.brandId}`);
    if (q.unitId) where.push(Prisma.sql`p.unit_id = ${q.unitId}`);
    if (q.taxId) where.push(Prisma.sql`p.tax = ${q.taxId}`);
    if (q.activeState === 'active') where.push(Prisma.sql`p.is_inactive = 0`);
    if (q.activeState === 'inactive') where.push(Prisma.sql`p.is_inactive = 1`);
    if (q.notForSelling === true) where.push(Prisma.sql`p.not_for_selling = 1`);
    if (q.search) {
      const like = `%${escapeLike(q.search)}%`;
      where.push(
        Prisma.sql`(p.name LIKE ${like} OR p.sku LIKE ${like} OR EXISTS (SELECT 1 FROM variations sv WHERE sv.product_id = p.id AND sv.deleted_at IS NULL AND sv.sub_sku LIKE ${like}))`,
      );
    }
    if (locationNone) {
      where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM product_locations pl WHERE pl.product_id = p.id)`);
    } else if (locationId !== null) {
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM product_locations pl WHERE pl.product_id = p.id AND pl.location_id = ${locationId})`);
    } else if (permitted !== null) {
      where.push(
        permitted.length === 0
          ? Prisma.sql`1 = 0`
          : Prisma.sql`EXISTS (SELECT 1 FROM product_locations pl WHERE pl.product_id = p.id AND pl.location_id IN (${Prisma.join(permitted)}))`,
      );
    }
    const stock = Prisma.sql`COALESCE(agg.stock, 0)`;
    switch (q.stockStatus) {
      case 'not_tracked':
        where.push(Prisma.sql`p.enable_stock = 0`);
        break;
      case 'out_of_stock':
        where.push(Prisma.sql`p.enable_stock = 1 AND ${stock} <= 0`);
        break;
      case 'low_stock':
        where.push(Prisma.sql`p.enable_stock = 1 AND p.alert_quantity IS NOT NULL AND ${stock} > 0 AND ${stock} <= p.alert_quantity`);
        break;
      case 'in_stock':
        where.push(Prisma.sql`p.enable_stock = 1 AND ${stock} > 0 AND (p.alert_quantity IS NULL OR ${stock} > p.alert_quantity)`);
        break;
      default:
        break;
    }

    // Aggregates per product in a sub-select: portable across ONLY_FULL_GROUP_BY and keeps the page query simple.
    const agg = Prisma.sql`
      LEFT JOIN (
        SELECT v.product_id,
               SUM(vld.qty_available) AS stock,
               MIN(v.sell_price_inc_tax) AS min_price, MAX(v.sell_price_inc_tax) AS max_price,
               MIN(v.dpp_inc_tax) AS min_purchase_price, MAX(v.dpp_inc_tax) AS max_purchase_price,
               COUNT(DISTINCT v.id) AS variation_count
        FROM variations v
        JOIN products pp ON pp.id = v.product_id AND pp.business_id = ${biz}
        LEFT JOIN variation_location_details vld ON vld.variation_id = v.id ${stockLocations}
        WHERE v.deleted_at IS NULL
        GROUP BY v.product_id
      ) agg ON agg.product_id = p.id`;
    const whereSql = Prisma.join(where, ' AND ');

    const sortKey = q.sortBy && LIST_SORT[q.sortBy] ? q.sortBy : 'name';
    const dir = q.sortDir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const orderSql = Prisma.sql`${Prisma.raw(LIST_SORT[sortKey])} ${dir}, p.id ASC`;
    const skip = (q.page - 1) * q.perPage;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<ListRow[]>`
        SELECT p.id, p.name, p.type, p.sku, p.image, p.enable_stock, p.is_inactive, p.not_for_selling, p.alert_quantity, p.updated_at,
               u.short_name AS unit, b.name AS brand, c1.name AS category, c2.name AS sub_category, tr.name AS tax_name,
               agg.stock, agg.min_price, agg.max_price, agg.min_purchase_price, agg.max_purchase_price, agg.variation_count
        FROM products p
        LEFT JOIN units u ON u.id = p.unit_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c1 ON c1.id = p.category_id
        LEFT JOIN categories c2 ON c2.id = p.sub_category_id
        LEFT JOIN tax_rates tr ON tr.id = p.tax
        ${agg}
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ${q.perPage} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: bigint | number }[]>`SELECT COUNT(*) AS total FROM products p ${agg} WHERE ${whereSql}`,
    ]);
    const total = Number(totals[0]?.total ?? 0);

    const locationsByProduct = new Map<number, { id: number; name: string }[]>();
    if (rows.length > 0) {
      const locs = await this.prisma.$queryRaw<{ product_id: bigint | number; id: bigint | number; name: string }[]>`
        SELECT pl.product_id, bl.id, bl.name FROM product_locations pl
        JOIN business_locations bl ON bl.id = pl.location_id AND bl.business_id = ${biz} AND bl.deleted_at IS NULL
        WHERE pl.product_id IN (${Prisma.join(rows.map((r) => Number(r.id)))})
        ORDER BY bl.name`;
      for (const l of locs) {
        const arr = locationsByProduct.get(Number(l.product_id)) ?? [];
        arr.push({ id: Number(l.id), name: l.name });
        locationsByProduct.set(Number(l.product_id), arr);
      }
    }

    const data = rows.map((r) => {
      const enableStock = bool(r.enable_stock);
      const productId = Number(r.id);
      return {
        id: productId,
        name: r.name,
        type: r.type,
        sku: r.sku,
        image: r.image,
        enable_stock: enableStock,
        is_inactive: bool(r.is_inactive),
        not_for_selling: bool(r.not_for_selling),
        alert_quantity: dec(r.alert_quantity),
        unit: r.unit,
        brand: r.brand,
        category: r.category,
        sub_category: r.sub_category,
        tax_name: r.tax_name,
        variation_count: Number(r.variation_count ?? 0),
        current_stock: enableStock ? dec(r.stock) ?? '0' : null,
        stock_status: stockStatus({ enableStock, qty: r.stock, alertQuantity: r.alert_quantity }),
        min_price: dec(r.min_price),
        max_price: dec(r.max_price),
        min_purchase_price: showPurchase ? dec(r.min_purchase_price) : null,
        max_purchase_price: showPurchase ? dec(r.max_purchase_price) : null,
        locations: locationsByProduct.get(productId) ?? [],
        updated_at: r.updated_at,
      };
    });
    return paginated(data, total, q);
  }

  // ---------------------------------------------------------------- search

  /** Autocomplete for POS, purchases and combo pickers: one row per variation. */
  async search(user: AuthUser, q: SearchQueryDto) {
    const permitted = permittedLocationIds(user);
    if (q.locationId && permitted !== null && !permitted.includes(q.locationId)) throw new ForbiddenException('You cannot see this location');
    // Purchase price is only for people who may see it or who build products/combos.
    const showPurchase = can(user, 'view_purchase_price') || can(user, 'product.create') || can(user, 'product.update');

    const where: Prisma.Sql[] = [
      Prisma.sql`p.business_id = ${user.businessId}`,
      Prisma.sql`p.type <> 'modifier'`,
      Prisma.sql`p.is_inactive = 0`,
      Prisma.sql`v.deleted_at IS NULL`,
    ];
    if (q.notForSelling !== undefined) where.push(Prisma.sql`p.not_for_selling = ${q.notForSelling ? 1 : 0}`);
    const types = (q.productTypes ?? '').split(',').map((t) => t.trim()).filter((t) => ['single', 'variable', 'combo'].includes(t));
    if (types.length > 0) where.push(Prisma.sql`p.type IN (${Prisma.join(types)})`);
    if (q.term) {
      const like = `%${escapeLike(q.term)}%`;
      where.push(Prisma.sql`(p.name LIKE ${like} OR p.sku LIKE ${like} OR v.sub_sku LIKE ${like})`);
    }
    if (q.locationId) {
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM product_locations pl WHERE pl.product_id = p.id AND pl.location_id = ${q.locationId})`);
    } else if (permitted !== null) {
      where.push(
        permitted.length === 0
          ? Prisma.sql`1 = 0`
          : Prisma.sql`EXISTS (SELECT 1 FROM product_locations pl WHERE pl.product_id = p.id AND pl.location_id IN (${Prisma.join(permitted)}))`,
      );
    }
    let vldLocations: Prisma.Sql = Prisma.empty;
    if (q.locationId) vldLocations = Prisma.sql`AND vld.location_id = ${q.locationId}`;
    else if (permitted !== null) vldLocations = permitted.length === 0 ? Prisma.sql`AND 1 = 0` : Prisma.sql`AND vld.location_id IN (${Prisma.join(permitted)})`;
    if (q.checkQty) where.push(Prisma.sql`(p.enable_stock = 0 OR COALESCE(st.qty, 0) > 0)`);

    const groupJoin = q.priceGroupId
      ? Prisma.sql`LEFT JOIN variation_group_prices vgp ON vgp.variation_id = v.id AND vgp.price_group_id = ${q.priceGroupId}`
      : Prisma.empty;
    const groupCols = q.priceGroupId ? Prisma.sql`vgp.price_inc_tax AS group_price, vgp.price_type AS group_price_type` : Prisma.sql`NULL AS group_price, NULL AS group_price_type`;

    const rows = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT p.id AS product_id, p.name, p.type, p.enable_stock, v.id AS variation_id, v.name AS variation, v.sub_sku, p.sku,
             u.short_name AS unit, p.unit_id, v.default_purchase_price AS purchase_price, COALESCE(st.qty, 0) AS qty_available, v.sell_price_inc_tax AS selling_price, ${groupCols}
      FROM variations v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN units u ON u.id = p.unit_id
      LEFT JOIN (
        SELECT vld.variation_id, SUM(vld.qty_available) AS qty FROM variation_location_details vld
        WHERE 1 = 1 ${vldLocations} GROUP BY vld.variation_id
      ) st ON st.variation_id = v.id
      ${groupJoin}
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY COALESCE(st.qty, 0) DESC, p.name ASC, v.id ASC
      LIMIT ${q.limit ?? 30}`;

    return rows.map((r) => {
      const sellingPrice = new Prisma.Decimal(r.selling_price ?? 0);
      const gp =
        r.group_price !== null && r.group_price !== undefined
          ? groupPrice(r.group_price_type === 'percentage' ? 'percentage' : 'fixed', r.group_price, sellingPrice)
          : null;
      const label = r.type === 'variable' ? `${r.name} - ${r.variation} (${r.sub_sku ?? r.sku})` : `${r.name} (${r.sub_sku ?? r.sku})`;
      return {
        product_id: Number(r.product_id),
        variation_id: Number(r.variation_id),
        name: r.name,
        variation: r.variation,
        type: r.type,
        sku: r.sku,
        sub_sku: r.sub_sku,
        unit: r.unit,
        unit_id: r.unit_id === null ? null : Number(r.unit_id),
        purchase_price: showPurchase ? dec(r.purchase_price) : null,
        enable_stock: bool(r.enable_stock),
        qty_available: bool(r.enable_stock) ? dec(r.qty_available) ?? '0' : null,
        selling_price: sellingPrice.toFixed(),
        group_price: gp ? gp.toFixed() : null,
        label,
      };
    });
  }

  // ------------------------------------------------------------- sku check

  /** Laravel `check_product_sku`: a SKU is free when no other product SKU and no other variation sub-SKU uses it. */
  async checkSku(user: AuthUser, q: CheckSkuQueryDto) {
    const taken = await this.skuTaken(this.prisma, user.businessId, q.sku.trim(), { productId: q.productId, variationId: q.variationId });
    return { sku: q.sku, available: !taken };
  }

  private async skuTaken(client: Tx | PrismaService, biz: number, sku: string, ignore: { productId?: number; variationId?: number }): Promise<boolean> {
    if (!sku) return false;
    const product = await client.products.findFirst({
      where: { business_id: biz, sku, ...(ignore.productId ? { id: { not: ignore.productId } } : {}) },
      select: { id: true },
    });
    if (product) return true;
    const variation = await client.variations.findFirst({
      where: {
        sub_sku: sku,
        deleted_at: null,
        products: { business_id: biz },
        ...(ignore.productId ? { product_id: { not: ignore.productId } } : {}),
        ...(ignore.variationId ? { id: { not: ignore.variationId } } : {}),
      },
      select: { id: true },
    });
    return !!variation;
  }

  /** Sub-SKUs of variable products: unique inside the payload and against every product / other variation of the business. */
  private async assertSubSkusFree(tx: Tx, biz: number, items: { sku: string; variationId?: number }[]) {
    const dup = firstDuplicate(items.map((i) => i.sku));
    if (dup) throw new BadRequestException(`SKU "${dup}" is used twice in this product`);
    for (const item of items) {
      const product = await tx.products.findFirst({ where: { business_id: biz, sku: item.sku }, select: { id: true } });
      const variation = await tx.variations.findFirst({
        where: { sub_sku: item.sku, deleted_at: null, products: { business_id: biz }, ...(item.variationId ? { id: { not: item.variationId } } : {}) },
        select: { id: true },
      });
      if (product || variation) throw new ConflictException(`SKU "${item.sku}" is already used by another product`);
    }
  }

  // ------------------------------------------------------------------- get

  async get(user: AuthUser, id: number) {
    return this.load(user, id, false);
  }

  /** `revealPurchase` is for internal callers (duplicate) that need the purchase prices whatever the user may see. */
  private async load(user: AuthUser, id: number, revealPurchase: boolean) {
    const biz = user.businessId;
    const db = this.prisma.forTenant(biz);
    const p = await db.products.findFirst({
      where: { id },
      include: {
        product_variations: {
          orderBy: { id: 'asc' },
          include: {
            variations: {
              where: { deleted_at: null },
              orderBy: { id: 'asc' },
              include: { variation_group_prices: true, variation_location_details: true },
            },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');

    const ids = (v: (number | null)[]) => [...new Set(v.filter((x): x is number => x != null))];
    const [unit, secondaryUnit, brand, categories, tax, warranty, locationRows, priceGroups, locations] = await Promise.all([
      p.unit_id ? db.units.findFirst({ where: { id: p.unit_id } }) : null,
      p.secondary_unit_id ? db.units.findFirst({ where: { id: p.secondary_unit_id } }) : null,
      p.brand_id ? db.brands.findFirst({ where: { id: p.brand_id } }) : null,
      db.categories.findMany({ where: { id: { in: ids([p.category_id, p.sub_category_id]) } } }),
      p.tax ? db.tax_rates.findFirst({ where: { id: p.tax } }) : null,
      p.warranty_id ? db.warranties.findFirst({ where: { id: p.warranty_id } }) : null,
      this.prisma.$queryRaw<{ location_id: bigint | number }[]>`SELECT location_id FROM product_locations WHERE product_id = ${id}`,
      db.selling_price_groups.findMany({ where: { is_active: true, deleted_at: null }, orderBy: { name: 'asc' } }),
      db.business_locations.findMany({ where: { deleted_at: null }, select: { id: true, name: true } }),
    ]);
    const locationIds = locationRows.map((r) => Number(r.location_id));
    const cat = new Map(categories.map((c) => [c.id, c.name]));
    const locName = new Map(locations.map((l) => [l.id, l.name]));
    const permitted = permittedLocationIds(user);
    const visible = (locId: number) => permitted === null || permitted.includes(locId);
    const showPurchase = revealPurchase || can(user, 'view_purchase_price') || can(user, 'product.update');
    const allowedGroups = priceGroups.filter((g) => can(user, `selling_price_group.${g.id}`));

    // Components of a combo product.
    const comboLines = p.type === 'combo' ? parseComboVariations(p.product_variations.flatMap((pv) => pv.variations)[0]?.combo_variations) : [];
    const comboItems = await this.describeComboLines(user, comboLines, showPurchase);

    let currentStock = new Prisma.Decimal(0);
    const groups = p.product_variations
      .filter((pv) => pv.variations.length > 0)
      .map((pv) => ({
        id: pv.id,
        name: pv.name,
        is_dummy: pv.is_dummy,
        variation_template_id: pv.variation_template_id,
        variations: pv.variations.map((v) => {
          const stock = v.variation_location_details
            .filter((d) => visible(d.location_id))
            .map((d) => ({ location_id: d.location_id, location_name: locName.get(d.location_id) ?? '', qty_available: d.qty_available.toFixed() }));
          for (const d of v.variation_location_details) if (visible(d.location_id)) currentStock = currentStock.add(d.qty_available);
          return {
            id: v.id,
            name: v.name,
            sub_sku: v.sub_sku,
            variation_value_id: v.variation_value_id,
            default_purchase_price: showPurchase ? dec(v.default_purchase_price) : null,
            dpp_inc_tax: showPurchase ? dec(v.dpp_inc_tax) : null,
            profit_percent: showPurchase ? dec(v.profit_percent) : null,
            default_sell_price: dec(v.default_sell_price),
            sell_price_inc_tax: dec(v.sell_price_inc_tax),
            stock,
            group_prices: v.variation_group_prices
              .filter((g) => allowedGroups.some((a) => a.id === g.price_group_id))
              .map((g) => ({
                price_group_id: g.price_group_id,
                price_inc_tax: g.price_inc_tax.toFixed(),
                price_type: g.price_type,
                calculated_price: groupPrice(g.price_type === 'percentage' ? 'percentage' : 'fixed', g.price_inc_tax, v.sell_price_inc_tax ?? 0).toFixed(),
              })),
          };
        }),
      }));

    return {
      id: p.id,
      name: p.name,
      type: p.type,
      sku: p.sku,
      barcode_type: p.barcode_type,
      image: p.image,
      unit_id: p.unit_id,
      unit: unit ? { id: unit.id, actual_name: unit.actual_name, short_name: unit.short_name, allow_decimal: unit.allow_decimal } : null,
      secondary_unit_id: p.secondary_unit_id,
      secondary_unit_name: secondaryUnit?.actual_name ?? null,
      sub_unit_ids: parseSubUnitIds(p.sub_unit_ids),
      brand_id: p.brand_id,
      brand_name: brand?.name ?? null,
      category_id: p.category_id,
      category_name: p.category_id ? cat.get(p.category_id) ?? null : null,
      sub_category_id: p.sub_category_id,
      sub_category_name: p.sub_category_id ? cat.get(p.sub_category_id) ?? null : null,
      tax: p.tax,
      tax_name: tax?.name ?? null,
      tax_rate: tax ? String(tax.amount) : '0',
      tax_type: p.tax_type,
      enable_stock: p.enable_stock,
      alert_quantity: dec(p.alert_quantity),
      expiry_period: dec(p.expiry_period),
      expiry_period_type: p.expiry_period_type,
      enable_sr_no: p.enable_sr_no,
      weight: p.weight,
      product_description: p.product_description,
      warranty_id: p.warranty_id,
      warranty_name: warranty?.name ?? null,
      is_inactive: p.is_inactive,
      not_for_selling: p.not_for_selling,
      preparation_time_in_minutes: p.preparation_time_in_minutes,
      location_ids: locationIds.filter(visible),
      locations: locationIds.filter(visible).map((id) => ({ id, name: locName.get(id) ?? '' })),
      current_stock: p.enable_stock ? currentStock.toFixed() : null,
      stock_status: stockStatus({ enableStock: p.enable_stock, qty: currentStock, alertQuantity: p.alert_quantity }),
      price_groups: allowedGroups.map((g) => ({ id: g.id, name: g.name })),
      product_variations: groups,
      combo_items: comboItems,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  private async describeComboLines(user: AuthUser, lines: { variation_id: number; quantity: number; unit_id: number | null }[], showPurchase: boolean) {
    if (lines.length === 0) return [];
    const db = this.prisma.forTenant(user.businessId);
    const variations = await db.variations.findMany({
      where: { id: { in: lines.map((l) => l.variation_id) }, products: { business_id: user.businessId } },
      include: { products: { select: { id: true, name: true, type: true, unit_id: true } } },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    const unitIds = [...new Set(lines.map((l) => l.unit_id).filter((x): x is number => x != null))];
    const units = unitIds.length ? await db.units.findMany({ where: { id: { in: unitIds } } }) : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    return lines.flatMap((l) => {
      const v = byId.get(l.variation_id);
      if (!v) return [];
      const unit = l.unit_id ? unitById.get(l.unit_id) : undefined;
      return [
        {
          variation_id: v.id,
          product_id: v.product_id,
          product_name: v.products.name,
          variation_name: v.products.type === 'variable' ? v.name : null,
          sub_sku: v.sub_sku,
          quantity: String(l.quantity),
          unit_id: l.unit_id ?? v.products.unit_id,
          product_unit_id: v.products.unit_id,
          unit_name: unit?.actual_name ?? null,
          multiplier: unit?.base_unit_multiplier ? String(unit.base_unit_multiplier) : '1',
          purchase_price: showPurchase ? dec(v.default_purchase_price) : null,
        },
      ];
    });
  }

  // ---------------------------------------------------------------- create

  async create(user: AuthUser, dto: ProductDto) {
    assertProductShape({
      type: dto.type,
      enableStock: dto.enableStock,
      expiryPeriod: dto.expiryPeriod != null ? Number(dto.expiryPeriod) : null,
      expiryPeriodType: dto.expiryPeriodType,
      comboItemCount: dto.comboItems?.length,
      variationGroups: dto.variationGroups,
    });
    const refs = await this.checkReferences(user, dto);
    const locationIds = this.checkLocations(user, dto.locationIds, refs.validLocationIds, undefined);
    const business = await this.prisma.business.findUnique({ where: { id: user.businessId }, select: { sku_prefix: true } });
    const now = new Date();
    const taxType: TaxType = dto.taxType ?? 'exclusive';
    const providedSku = dto.sku?.trim() ?? '';

    const id = await this.prisma.$transaction(async (tx) => {
      if (providedSku && (await this.skuTaken(tx, user.businessId, providedSku, {}))) {
        throw new ConflictException(`SKU "${providedSku}" is already used by another product`);
      }
      const product = await tx.products.create({
        data: {
          business_id: user.businessId,
          created_by: user.id,
          name: dto.name.trim(),
          type: dto.type,
          sku: providedSku || ' ',
          barcode_type: dto.barcodeType ?? 'C128',
          unit_id: dto.unitId,
          secondary_unit_id: dto.secondaryUnitId ?? null,
          sub_unit_ids: serializeSubUnitIds(dto.subUnitIds),
          brand_id: dto.brandId ?? null,
          category_id: dto.categoryId ?? null,
          sub_category_id: dto.subCategoryId ?? null,
          tax: dto.taxId ?? null,
          tax_type: taxType,
          enable_stock: dto.enableStock ?? false,
          alert_quantity: dto.alertQuantity != null && dto.alertQuantity !== '' ? toDecimal(dto.alertQuantity) : null,
          expiry_period: dto.enableStock && dto.expiryPeriod ? toDecimal(dto.expiryPeriod) : null,
          expiry_period_type: dto.enableStock && dto.expiryPeriod ? dto.expiryPeriodType ?? null : null,
          enable_sr_no: dto.enableSrNo ?? false,
          weight: dto.weight || null,
          product_description: dto.description || null,
          warranty_id: dto.warrantyId ?? null,
          not_for_selling: dto.notForSelling ?? false,
          preparation_time_in_minutes: dto.preparationTimeInMinutes ?? null,
          created_at: now,
          updated_at: now,
        },
      });
      let sku = product.sku;
      if (!providedSku) {
        sku = generateProductSku(business?.sku_prefix, product.id);
        if (await this.skuTaken(tx, user.businessId, sku, { productId: product.id })) {
          throw new ConflictException(`The generated SKU "${sku}" is already used. Enter a SKU manually`);
        }
        await tx.products.update({ where: { id: product.id }, data: { sku } });
      }
      await this.writeLocations(tx, product.id, locationIds);

      if (dto.type === 'variable') {
        await this.createVariableVariations(tx, user, product.id, sku, dto.barcodeType ?? 'C128', refs.taxRate, taxType, dto.variationGroups ?? [], dto.skuType);
      } else {
        const combo = dto.type === 'combo' ? await this.buildCombo(tx, user, dto.comboItems ?? [], null) : null;
        await this.createSingleVariation(tx, product.id, sku, dto.prices ?? {}, refs.taxRate, taxType, combo);
      }
      return product.id;
    }, TX_OPTIONS);
    return this.get(user, id);
  }

  private async createSingleVariation(
    tx: Tx,
    productId: number,
    sku: string,
    prices: PriceInput,
    taxRate: Prisma.Decimal,
    taxType: TaxType,
    combo: { json: string; purchaseTotal: Prisma.Decimal } | null,
  ) {
    const now = new Date();
    const calc = calculateVariationPrices(combo ? { ...prices, purchasePriceExcTax: combo.purchaseTotal, purchasePriceIncTax: undefined } : prices, taxRate, taxType);
    const pv = await tx.product_variations.create({ data: { name: 'DUMMY', product_id: productId, is_dummy: true, created_at: now, updated_at: now } });
    await tx.variations.create({
      data: { name: 'DUMMY', product_id: productId, product_variation_id: pv.id, sub_sku: sku, ...calc, combo_variations: combo?.json ?? '[]', created_at: now, updated_at: now },
    });
  }

  /** Validates the components of a combo and returns the stored JSON plus the calculated purchase price. */
  private async buildCombo(tx: Tx, user: AuthUser, items: ComboItemDto[], selfProductId: number | null) {
    const variations = await tx.variations.findMany({
      where: { id: { in: items.map((i) => i.variationId) }, deleted_at: null, products: { business_id: user.businessId } },
      include: { products: { select: { id: true, type: true, unit_id: true, name: true } } },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    const unitIds = [...new Set(items.map((i) => i.unitId).filter((x): x is number => x != null))];
    const units = unitIds.length ? await tx.units.findMany({ where: { id: { in: unitIds }, business_id: user.businessId, deleted_at: null } }) : [];
    const unitById = new Map(units.map((u) => [u.id, u]));

    const stored: { variation_id: number; quantity: number; unit_id: number | null }[] = [];
    const lines: { quantity: string | number; multiplier: string | number; purchasePrice: Prisma.Decimal | string | number }[] = [];
    for (const item of items) {
      const v = byId.get(item.variationId);
      if (!v) throw new BadRequestException(`Component product (variation ${item.variationId}) was not found`);
      if (v.products.type === 'combo' || v.products.type === 'modifier') throw new BadRequestException(`"${v.products.name}" cannot be part of a combo`);
      if (selfProductId !== null && v.product_id === selfProductId) throw new BadRequestException('A combo cannot contain itself');
      const unitId = item.unitId ?? v.products.unit_id;
      let multiplier: string | number = 1;
      if (unitId && unitId !== v.products.unit_id) {
        const unit = unitById.get(unitId);
        if (!unit || unit.base_unit_id !== v.products.unit_id || !unit.base_unit_multiplier) {
          throw new BadRequestException(`The unit chosen for "${v.products.name}" is not valid for it`);
        }
        multiplier = unit.base_unit_multiplier.toFixed();
      }
      stored.push({ variation_id: v.id, quantity: Number(toDecimal(item.quantity)), unit_id: unitId ?? null });
      lines.push({ quantity: item.quantity, multiplier, purchasePrice: v.default_purchase_price ?? 0 });
    }
    return { json: JSON.stringify(stored), purchaseTotal: comboPurchaseTotal(lines) };
  }

  // ------------------------------------------------- variable variations

  /** Finds or creates the variation template (e.g. "Size") and value template (e.g. "XL") the way Laravel does. */
  private async resolveTemplate(tx: Tx, biz: number, g: VariationGroupDto) {
    if (g.variationTemplateId) {
      const t = await tx.variation_templates.findFirst({ where: { id: g.variationTemplateId, business_id: biz }, include: { variation_value_templates: true } });
      if (!t) throw new BadRequestException(`Variation template for "${g.name}" was not found`);
      return t;
    }
    const all = await tx.variation_templates.findMany({ where: { business_id: biz }, include: { variation_value_templates: true } });
    const found = all.find((t) => t.name.trim().toLowerCase() === g.name.trim().toLowerCase());
    if (found) return found;
    const now = new Date();
    const created = await tx.variation_templates.create({ data: { name: g.name.trim(), business_id: biz, created_at: now, updated_at: now } });
    return { ...created, variation_value_templates: [] as { id: number; name: string; variation_template_id: number }[] };
  }

  private async resolveValueTemplate(
    tx: Tx,
    template: { id: number; variation_value_templates: { id: number; name: string }[] },
    v: VariationValueDto,
  ): Promise<{ id: number; name: string }> {
    if (v.variationValueId) {
      const found = template.variation_value_templates.find((x) => x.id === v.variationValueId);
      if (!found) throw new BadRequestException(`Value "${v.name}" does not belong to its variation template`);
      return found;
    }
    const byName = template.variation_value_templates.find((x) => x.name.trim().toLowerCase() === v.name.trim().toLowerCase());
    if (byName) return byName;
    const now = new Date();
    const created = await tx.variation_value_templates.create({ data: { name: v.name.trim(), variation_template_id: template.id, created_at: now, updated_at: now } });
    template.variation_value_templates.push(created);
    return created;
  }

  private async createVariableVariations(
    tx: Tx,
    user: AuthUser,
    productId: number,
    productSku: string,
    barcodeType: string,
    taxRate: Prisma.Decimal,
    taxType: TaxType,
    groups: VariationGroupDto[],
    skuType: ProductDto['skuType'],
  ) {
    const now = new Date();
    for (const g of groups) await this.createVariationGroup(tx, user, productId, productSku, barcodeType, taxRate, taxType, g, skuType, now);
  }

  private async createVariationGroup(
    tx: Tx,
    user: AuthUser,
    productId: number,
    productSku: string,
    barcodeType: string,
    taxRate: Prisma.Decimal,
    taxType: TaxType,
    g: VariationGroupDto,
    skuType: ProductDto['skuType'],
    now: Date,
  ) {
    const template = await this.resolveTemplate(tx, user.businessId, g);
    const pv = await tx.product_variations.create({
      data: { name: template.name, product_id: productId, is_dummy: false, variation_template_id: template.id, created_at: now, updated_at: now },
    });
    // Running number counts soft-deleted variations too, so numbers are never reused.
    let counter = (await tx.variations.count({ where: { product_id: productId } })) + 1;
    const rows: { name: string; valueId: number; subSku: string; calc: ReturnType<typeof calculateVariationPrices> }[] = [];
    for (const v of g.variations) {
      const value = await this.resolveValueTemplate(tx, template, v);
      const subSku = v.subSku?.trim() || generateSubSku(productSku, counter, barcodeType, value.name, skuType);
      counter += 1;
      rows.push({ name: value.name, valueId: value.id, subSku, calc: calculateVariationPrices(v, taxRate, taxType) });
    }
    await this.assertSubSkusFree(tx, user.businessId, rows.map((r) => ({ sku: r.subSku })));
    for (const r of rows) {
      await tx.variations.create({
        data: {
          name: r.name,
          variation_value_id: r.valueId,
          product_id: productId,
          product_variation_id: pv.id,
          sub_sku: r.subSku,
          ...r.calc,
          combo_variations: '[]',
          created_at: now,
          updated_at: now,
        },
      });
    }
  }

  /** Edit of a variable product: update known groups/values, create new ones, remove the ones that are gone (when allowed). */
  private async syncVariableVariations(
    tx: Tx,
    user: AuthUser,
    productId: number,
    productSku: string,
    barcodeType: string,
    taxRate: Prisma.Decimal,
    taxType: TaxType,
    groups: VariationGroupDto[],
    skuType: ProductDto['skuType'],
  ) {
    const now = new Date();
    const existingGroups = await tx.product_variations.findMany({ where: { product_id: productId }, include: { variations: { where: { deleted_at: null } } } });
    const keptVariationIds = new Set<number>();

    for (const g of groups) {
      if (!g.id) {
        await this.createVariationGroup(tx, user, productId, productSku, barcodeType, taxRate, taxType, g, skuType, now);
        continue;
      }
      const group = existingGroups.find((x) => x.id === g.id);
      if (!group) throw new BadRequestException(`Variation "${g.name}" does not belong to this product`);
      await tx.product_variations.update({ where: { id: group.id }, data: { name: g.name.trim(), updated_at: now } });

      const template = group.variation_template_id
        ? await tx.variation_templates.findFirst({ where: { id: group.variation_template_id, business_id: user.businessId }, include: { variation_value_templates: true } })
        : null;
      let counter = (await tx.variations.count({ where: { product_id: productId } })) + 1;

      const skuChecks: { sku: string; variationId?: number }[] = [];
      const updates: { id: number; name: string; subSku?: string; calc: ReturnType<typeof calculateVariationPrices> }[] = [];
      const creates: { name: string; valueId: number | null; subSku: string; calc: ReturnType<typeof calculateVariationPrices> }[] = [];
      for (const v of g.variations) {
        const calc = calculateVariationPrices(v, taxRate, taxType);
        if (v.id) {
          const current = group.variations.find((x) => x.id === v.id);
          if (!current) throw new BadRequestException(`Value "${v.name}" does not belong to "${g.name}"`);
          keptVariationIds.add(current.id);
          const subSku = v.subSku?.trim() || undefined;
          if (subSku && subSku !== current.sub_sku) skuChecks.push({ sku: subSku, variationId: current.id });
          updates.push({ id: current.id, name: v.name.trim(), subSku, calc });
        } else {
          const value = template ? await this.resolveValueTemplate(tx, template, v) : null;
          const subSku = v.subSku?.trim() || generateSubSku(productSku, counter, barcodeType, v.name, skuType);
          counter += 1;
          skuChecks.push({ sku: subSku });
          creates.push({ name: value?.name ?? v.name.trim(), valueId: value?.id ?? null, subSku, calc });
        }
      }
      await this.assertSubSkusFree(tx, user.businessId, skuChecks);
      for (const u of updates) {
        await tx.variations.update({ where: { id: u.id }, data: { name: u.name, ...(u.subSku ? { sub_sku: u.subSku } : {}), ...u.calc, updated_at: now } });
      }
      for (const c of creates) {
        const row = await tx.variations.create({
          data: {
            name: c.name,
            variation_value_id: c.valueId,
            product_id: productId,
            product_variation_id: group.id,
            sub_sku: c.subSku,
            ...c.calc,
            combo_variations: '[]',
            created_at: now,
            updated_at: now,
          },
        });
        keptVariationIds.add(row.id);
      }
    }

    // Variations that are no longer in the form.
    const removed = existingGroups.flatMap((g) => g.variations).filter((v) => !keptVariationIds.has(v.id));
    for (const v of removed) {
      const [purchaseLines, sellLines, stockAdjustmentLines] = await Promise.all([
        tx.purchase_lines.count({ where: { variation_id: v.id } }),
        tx.transaction_sell_lines.count({ where: { variation_id: v.id } }),
        tx.stock_adjustment_lines.count({ where: { variation_id: v.id } }),
      ]);
      const blocker = variationRemovalBlocker({ purchaseLines, sellLines, stockAdjustmentLines });
      if (blocker) throw new BadRequestException(`${blocker} (${v.name})`);
      await tx.variation_location_details.deleteMany({ where: { variation_id: v.id } });
      await tx.variation_group_prices.deleteMany({ where: { variation_id: v.id } });
      await tx.variations.update({ where: { id: v.id }, data: { deleted_at: now } });
    }
  }

  // ---------------------------------------------------------------- update

  async update(user: AuthUser, id: number, dto: ProductDto) {
    const db = this.prisma.forTenant(user.businessId);
    const existing = await db.products.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    if (dto.type !== existing.type) throw new BadRequestException('The product type cannot be changed after the product is created');

    assertProductShape({
      type: dto.type,
      enableStock: dto.enableStock,
      expiryPeriod: dto.expiryPeriod != null ? Number(dto.expiryPeriod) : null,
      expiryPeriodType: dto.expiryPeriodType,
      comboItemCount: dto.comboItems?.length,
      variationGroups: dto.variationGroups,
      partial: true,
    });
    const refs = await this.checkReferences(user, dto);
    const providedSku = dto.sku?.trim() ?? '';
    const sku = providedSku || existing.sku;
    const taxType: TaxType = dto.taxType ?? 'exclusive';
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (sku !== existing.sku && (await this.skuTaken(tx, user.businessId, sku, { productId: id }))) {
        throw new ConflictException(`SKU "${sku}" is already used by another product`);
      }
      await tx.products.update({
        where: { id },
        data: {
          name: dto.name.trim(),
          sku,
          barcode_type: dto.barcodeType ?? existing.barcode_type,
          unit_id: dto.unitId,
          secondary_unit_id: dto.secondaryUnitId ?? null,
          sub_unit_ids: serializeSubUnitIds(dto.subUnitIds),
          brand_id: dto.brandId ?? null,
          category_id: dto.categoryId ?? null,
          sub_category_id: dto.subCategoryId ?? null,
          tax: dto.taxId ?? null,
          tax_type: taxType,
          enable_stock: dto.enableStock ?? false,
          alert_quantity: dto.alertQuantity != null && dto.alertQuantity !== '' ? toDecimal(dto.alertQuantity) : null,
          expiry_period: dto.enableStock && dto.expiryPeriod ? toDecimal(dto.expiryPeriod) : null,
          expiry_period_type: dto.enableStock && dto.expiryPeriod ? dto.expiryPeriodType ?? null : null,
          enable_sr_no: dto.enableSrNo ?? false,
          weight: dto.weight || null,
          product_description: dto.description || null,
          warranty_id: dto.warrantyId ?? null,
          not_for_selling: dto.notForSelling ?? false,
          preparation_time_in_minutes: dto.preparationTimeInMinutes ?? null,
          updated_at: now,
        },
      });

      if (dto.locationIds !== undefined) {
        const current = (await tx.$queryRaw<{ location_id: bigint | number }[]>`SELECT location_id FROM product_locations WHERE product_id = ${id}`).map((r) => Number(r.location_id));
        const next = this.checkLocations(user, dto.locationIds, refs.validLocationIds, current);
        await this.writeLocations(tx, id, next);
      }

      if (existing.type === 'variable') {
        if (dto.variationGroups !== undefined) {
          await this.syncVariableVariations(tx, user, id, sku, dto.barcodeType ?? existing.barcode_type ?? 'C128', refs.taxRate, taxType, dto.variationGroups, dto.skuType);
        }
      } else {
        const variation = await tx.variations.findFirst({ where: { product_id: id, deleted_at: null }, orderBy: { id: 'asc' } });
        if (!variation) throw new BadRequestException('The product has no variation to update');
        const data: Prisma.variationsUncheckedUpdateInput = { sub_sku: sku, updated_at: now };
        if (existing.type === 'combo' && dto.comboItems !== undefined) {
          const combo = await this.buildCombo(tx, user, dto.comboItems, id);
          Object.assign(data, calculateVariationPrices({ ...(dto.prices ?? {}), purchasePriceExcTax: combo.purchaseTotal }, refs.taxRate, taxType), { combo_variations: combo.json });
        } else if (dto.prices) {
          Object.assign(data, calculateVariationPrices(dto.prices, refs.taxRate, taxType));
        }
        await tx.variations.update({ where: { id: variation.id }, data });
      }
    }, TX_OPTIONS);
    return this.get(user, id);
  }

  // ----------------------------------------------- activate / delete / bulk

  async setActive(user: AuthUser, id: number, active: boolean) {
    const res = await this.prisma.forTenant(user.businessId).products.updateMany({ where: { id }, data: { is_inactive: !active, updated_at: new Date() } });
    if (res.count === 0) throw new NotFoundException('Product not found');
    return { success: true, is_inactive: !active };
  }

  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const product = await db.products.findFirst({ where: { id }, select: { id: true, enable_stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    const blocker = await this.deletionBlocker(user.businessId, id, product.enable_stock);
    if (blocker) throw new BadRequestException(blocker);
    await this.hardDelete(user.businessId, id);
    return { success: true };
  }

  private async deletionBlocker(biz: number, productId: number, enableStock: boolean): Promise<string | null> {
    const [purchaseLines, soldOpeningStockLines, adjustedLines, sellLines, stockAdjustmentLines] = await Promise.all([
      this.prisma.purchase_lines.count({ where: { product_id: productId, transactions: { business_id: biz, type: 'purchase' } } }),
      this.prisma.purchase_lines.count({ where: { product_id: productId, quantity_sold: { gt: 0 }, transactions: { business_id: biz, type: 'opening_stock' } } }),
      this.prisma.purchase_lines.count({ where: { product_id: productId, quantity_adjusted: { gt: 0 }, transactions: { business_id: biz } } }),
      this.prisma.transaction_sell_lines.count({ where: { product_id: productId, transactions: { business_id: biz } } }),
      this.prisma.stock_adjustment_lines.count({ where: { product_id: productId, transactions: { business_id: biz } } }),
    ]);
    return productDeletionBlocker({ enableStock, purchaseLines, soldOpeningStockLines, adjustedLines, sellLines, stockAdjustmentLines });
  }

  /**
   * The products table has no deleted_at column (same as Laravel), so a product that passed the guard is removed for good,
   * together with its variations, stock rows, locations and its (unused) opening stock transactions.
   */
  private async hardDelete(biz: number, productId: number) {
    await this.prisma.$transaction(async (tx) => {
      const openingTx = await tx.transactions.findMany({ where: { business_id: biz, type: 'opening_stock', opening_stock_product_id: productId }, select: { id: true } });
      const txIds = openingTx.map((t) => t.id);
      if (txIds.length) {
        await tx.purchase_lines.deleteMany({ where: { transaction_id: { in: txIds } } });
        await tx.transactions.deleteMany({ where: { id: { in: txIds }, business_id: biz } });
      }
      await tx.variation_location_details.deleteMany({ where: { product_id: productId } });
      await tx.variation_group_prices.deleteMany({ where: { variations: { product_id: productId } } });
      await tx.$executeRaw`DELETE FROM product_locations WHERE product_id = ${productId}`;
      await tx.product_racks.deleteMany({ where: { product_id: productId, business_id: biz } });
      await tx.variations.deleteMany({ where: { product_id: productId } });
      await tx.product_variations.deleteMany({ where: { product_id: productId } });
      await tx.products.deleteMany({ where: { id: productId, business_id: biz } });
    }, TX_OPTIONS);
  }

  /** Mass delete / activate / deactivate. Products that cannot be deleted are reported, the rest still go through. */
  async bulk(user: AuthUser, dto: BulkActionDto) {
    const ids = [...new Set(dto.ids)];
    const db = this.prisma.forTenant(user.businessId);
    // The route allows either permission; the action decides which one is really needed.
    if (!can(user, dto.action === 'delete' ? 'product.delete' : 'product.update')) throw new ForbiddenException('Unauthorized action');
    if (dto.action !== 'delete') {
      const res = await db.products.updateMany({ where: { id: { in: ids } }, data: { is_inactive: dto.action === 'deactivate', updated_at: new Date() } });
      return { done: res.count, failed: [] as { id: number; name: string; reason: string }[] };
    }
    const products = await db.products.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, enable_stock: true } });
    let done = 0;
    const failed: { id: number; name: string; reason: string }[] = [];
    for (const p of products) {
      const blocker = await this.deletionBlocker(user.businessId, p.id, p.enable_stock);
      if (blocker) {
        failed.push({ id: p.id, name: p.name, reason: blocker });
        continue;
      }
      await this.hardDelete(user.businessId, p.id);
      done += 1;
    }
    return { done, failed };
  }

  // ------------------------------------------------------------- duplicate

  /** Copies a product (variations, prices, locations, group prices; never stock) under a new SKU and the name "<name> (copy)". */
  async duplicate(user: AuthUser, id: number) {
    const src = await this.load(user, id, true);
    const dto = new ProductDto();
    dto.name = `${src.name} (copy)`.slice(0, 191);
    dto.type = src.type as ProductDto['type'];
    dto.barcodeType = (src.barcode_type ?? 'C128') as ProductDto['barcodeType'];
    dto.unitId = src.unit_id as number;
    dto.secondaryUnitId = src.secondary_unit_id;
    dto.subUnitIds = src.sub_unit_ids;
    dto.brandId = src.brand_id;
    dto.categoryId = src.category_id;
    dto.subCategoryId = src.sub_category_id;
    dto.taxId = src.tax;
    dto.taxType = src.tax_type;
    dto.enableStock = src.enable_stock;
    dto.alertQuantity = src.alert_quantity;
    dto.expiryPeriod = src.expiry_period;
    dto.expiryPeriodType = src.expiry_period_type;
    dto.enableSrNo = src.enable_sr_no;
    dto.weight = src.weight;
    dto.description = src.product_description;
    dto.warrantyId = src.warranty_id;
    dto.notForSelling = src.not_for_selling;
    dto.preparationTimeInMinutes = src.preparation_time_in_minutes;
    dto.locationIds = src.location_ids;
    const priceOf = (v: { default_purchase_price: string | null; default_sell_price: string | null }) => ({
      purchasePriceExcTax: v.default_purchase_price ?? undefined,
      sellingPriceExcTax: v.default_sell_price ?? undefined,
    });
    if (src.type === 'variable') {
      dto.skuType = 'with_out_variation';
      dto.variationGroups = src.product_variations.map((g) => ({
        name: g.name,
        variationTemplateId: g.variation_template_id ?? undefined,
        variations: g.variations.map((v) => ({ name: v.name, variationValueId: v.variation_value_id ?? undefined, ...priceOf(v) })),
      }));
    } else {
      const only = src.product_variations[0]?.variations[0];
      if (only) dto.prices = priceOf(only);
      if (src.type === 'combo') dto.comboItems = src.combo_items.map((c) => ({ variationId: c.variation_id, quantity: c.quantity, unitId: c.unit_id ?? undefined }));
    }
    const created = await this.create(user, dto);

    // Group prices follow the variations in order.
    const srcVariations = src.product_variations.flatMap((g) => g.variations);
    const newVariations = created.product_variations.flatMap((g) => g.variations);
    const rows = srcVariations.flatMap((v, i) => {
      const target = newVariations[i];
      return target ? v.group_prices.map((gp) => ({ variation_id: target.id, price_group_id: gp.price_group_id, price_inc_tax: gp.price_inc_tax, price_type: gp.price_type })) : [];
    });
    if (rows.length) {
      const now = new Date();
      await this.prisma.variation_group_prices.createMany({ data: rows.map((r) => ({ ...r, created_at: now, updated_at: now })) });
    }
    return created;
  }

  // ----------------------------------------------------------- group prices

  async getGroupPrices(user: AuthUser, id: number) {
    const detail = await this.get(user, id);
    return {
      product: { id: detail.id, name: detail.name, type: detail.type },
      priceGroups: detail.price_groups,
      variations: detail.product_variations.flatMap((g) =>
        g.variations.map((v) => ({
          id: v.id,
          label: g.is_dummy ? detail.name : `${detail.name} - ${v.name}`,
          sub_sku: v.sub_sku,
          sell_price_inc_tax: v.sell_price_inc_tax,
          prices: v.group_prices,
        })),
      ),
    };
  }

  async saveGroupPrices(user: AuthUser, id: number, dto: GroupPricesDto) {
    const db = this.prisma.forTenant(user.businessId);
    const product = await db.products.findFirst({ where: { id }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const variations = await db.variations.findMany({ where: { product_id: id, deleted_at: null }, select: { id: true } });
    const groups = await db.selling_price_groups.findMany({ where: { is_active: true, deleted_at: null }, select: { id: true } });
    const okVariation = new Set(variations.map((v) => v.id));
    const okGroup = new Set(groups.filter((g) => can(user, `selling_price_group.${g.id}`)).map((g) => g.id));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const row of dto.prices) {
        if (!okVariation.has(row.variationId)) throw new BadRequestException('A variation does not belong to this product');
        if (!okGroup.has(row.priceGroupId)) throw new BadRequestException('A selling price group is not available');
        const existing = await tx.variation_group_prices.findFirst({ where: { variation_id: row.variationId, price_group_id: row.priceGroupId } });
        const blank = row.price === null || row.price === undefined || row.price === '';
        if (blank) {
          if (existing) await tx.variation_group_prices.delete({ where: { id: existing.id } });
          continue;
        }
        const price = toDecimal(row.price);
        if (price.isNegative()) throw new BadRequestException('Prices cannot be negative');
        if (row.priceType === 'percentage' && price.gt(1000)) throw new BadRequestException('A percentage price looks wrong');
        if (existing) {
          await tx.variation_group_prices.update({ where: { id: existing.id }, data: { price_inc_tax: price, price_type: row.priceType, updated_at: now } });
        } else {
          await tx.variation_group_prices.create({
            data: { variation_id: row.variationId, price_group_id: row.priceGroupId, price_inc_tax: price, price_type: row.priceType, created_at: now, updated_at: now },
          });
        }
      }
      await tx.products.updateMany({ where: { id, business_id: user.businessId }, data: { updated_at: now } });
    }, TX_OPTIONS);
    return this.getGroupPrices(user, id);
  }

  // ---------------------------------------------------------------- helpers

  /** Everything the product points at must belong to the caller's business. Returns the tax rate and valid location ids. */
  private async checkReferences(user: AuthUser, dto: ProductDto) {
    const db = this.prisma.forTenant(user.businessId);
    const unitIds = [dto.unitId, ...(dto.secondaryUnitId ? [dto.secondaryUnitId] : []), ...(dto.subUnitIds ?? [])];
    const [units, brand, categories, tax, warranty, locations] = await Promise.all([
      db.units.findMany({ where: { id: { in: unitIds }, deleted_at: null } }),
      dto.brandId ? db.brands.findFirst({ where: { id: dto.brandId, deleted_at: null } }) : null,
      db.categories.findMany({ where: { id: { in: [dto.categoryId ?? 0, dto.subCategoryId ?? 0] }, deleted_at: null } }),
      dto.taxId ? db.tax_rates.findFirst({ where: { id: dto.taxId, deleted_at: null } }) : null,
      dto.warrantyId ? db.warranties.findFirst({ where: { id: dto.warrantyId } }) : null,
      db.business_locations.findMany({ where: { deleted_at: null }, select: { id: true } }),
    ]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    if (!unitById.has(dto.unitId)) throw new BadRequestException('Unit not found');
    if (dto.secondaryUnitId && !unitById.has(dto.secondaryUnitId)) throw new BadRequestException('Secondary unit not found');
    for (const sid of dto.subUnitIds ?? []) {
      const u = unitById.get(sid);
      if (!u || (u.id !== dto.unitId && u.base_unit_id !== dto.unitId)) throw new BadRequestException('A sub-unit does not belong to the chosen unit');
    }
    if (dto.brandId && !brand) throw new BadRequestException('Brand not found');
    if (dto.categoryId && !categories.some((c) => c.id === dto.categoryId)) throw new BadRequestException('Category not found');
    if (dto.subCategoryId) {
      const sub = categories.find((c) => c.id === dto.subCategoryId);
      if (!sub) throw new BadRequestException('Sub-category not found');
      if (sub.parent_id !== dto.categoryId) throw new BadRequestException('The sub-category does not belong to the chosen category');
    }
    if (dto.taxId && !tax) throw new BadRequestException('Tax rate not found');
    if (dto.warrantyId && !warranty) throw new BadRequestException('Warranty not found');
    return {
      taxRate: tax ? new Prisma.Decimal(String(tax.amount)) : new Prisma.Decimal(0),
      validLocationIds: new Set(locations.map((l) => l.id)),
    };
  }

  /**
   * Final list of locations to store. The user may only assign locations they can access; on update the locations the
   * user cannot see are kept untouched (Laravel `ProductController::update`).
   */
  private checkLocations(user: AuthUser, wanted: number[] | undefined, valid: Set<number>, current: number[] | undefined): number[] {
    const permitted = permittedLocationIds(user);
    const next = [...new Set(wanted ?? [])];
    for (const l of next) {
      if (!valid.has(l)) throw new BadRequestException('A selected location was not found');
      if (permitted !== null && !permitted.includes(l)) throw new ForbiddenException('You cannot assign a location you have no access to');
    }
    if (permitted !== null && current) for (const l of current) if (!permitted.includes(l) && !next.includes(l)) next.push(l);
    return next;
  }

  private async writeLocations(tx: Tx, productId: number, locationIds: number[]) {
    await tx.$executeRaw`DELETE FROM product_locations WHERE product_id = ${productId}`;
    for (const locationId of locationIds) {
      await tx.$executeRaw`INSERT INTO product_locations (product_id, location_id) VALUES (${productId}, ${locationId})`;
    }
  }
}
