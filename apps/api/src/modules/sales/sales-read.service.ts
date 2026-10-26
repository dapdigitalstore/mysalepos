import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../common/can';
import { paginated } from '../../common/pagination';
import { wallClockToInstant } from '../../common/time';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { DraftListQueryDto, PosSettingsQueryDto, ProductRowQueryDto, RecentQueryDto, SaleListQueryDto, SHIPPING_STATUSES } from './sale.dto';
import { loadBusinessCtx, productLabel, stopSellingCutoffDay } from './sale-context';
import {
  calculateLine,
  customerGroupPrice,
  dec,
  displayPaymentStatus,
  expectedUnitPriceExcTax,
  groupPriceFor,
  linePermissions,
  parseComboComponents,
  parseIdList,
  permittedLocations,
  saleVisibility,
  showOwnOnly,
  totalPaid,
  unitMultiplier,
  ZERO,
} from './sale.rules';

type Dec = Prisma.Decimal;

const PAID_SQL = Prisma.sql`(SELECT COALESCE(SUM(IF(tp.is_return = 1, -1 * tp.amount, tp.amount)), 0) FROM transaction_payments tp WHERE tp.transaction_id = t.id)`;
const ADDED_BY_SQL = Prisma.sql`TRIM(CONCAT(COALESCE(u.surname, ''), ' ', COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))`;
const ESCAPE = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

const SORTABLE: Record<string, Prisma.Sql> = {
  transaction_date: Prisma.sql`t.transaction_date`,
  invoice_no: Prisma.sql`t.invoice_no`,
  customer: Prisma.sql`c.name`,
  mobile: Prisma.sql`c.mobile`,
  location: Prisma.sql`bl.name`,
  payment_status: Prisma.sql`t.payment_status`,
  final_total: Prisma.sql`t.final_total`,
  total_paid: PAID_SQL,
  total_remaining: Prisma.sql`(t.final_total - ${PAID_SQL})`,
  shipping_status: Prisma.sql`t.shipping_status`,
  added_by: ADDED_BY_SQL,
  total_items: Prisma.sql`(SELECT COUNT(*) FROM transaction_sell_lines tsl WHERE tsl.transaction_id = t.id AND tsl.parent_sell_line_id IS NULL)`,
  id: Prisma.sql`t.id`,
};

interface ListRow {
  id: number | bigint;
  invoice_no: string | null;
  transaction_date: Date;
  status: string;
  sub_status: string | null;
  payment_status: string | null;
  final_total: Dec | string;
  total_before_tax: Dec | string;
  tax_amount: Dec | string;
  discount_type: string | null;
  discount_amount: Dec | string | null;
  shipping_status: string | null;
  shipping_charges: Dec | string;
  is_direct_sale: number | boolean;
  is_suspend: number | boolean;
  pay_term_number: number | bigint | null;
  pay_term_type: string | null;
  location_id: number | bigint | null;
  contact_id: number | bigint | null;
  created_by: number | bigint;
  commission_agent: number | bigint | null;
  types_of_service_id: number | bigint | null;
  res_table_id: number | bigint | null;
  rp_earned: number | bigint;
  rp_redeemed: number | bigint;
  additional_notes: string | null;
  staff_note: string | null;
  contact_name: string | null;
  supplier_business_name: string | null;
  contact_mobile: string | null;
  contact_code: string | null;
  location_name: string | null;
  added_by: string | null;
  total_paid: Dec | string | null;
  total_items: number | bigint;
  return_total: Dec | string | null;
  return_paid: Dec | string | null;
}

const bool = (v: unknown) => v === true || v === 1 || v === 1n || v === '1';
const n = (v: number | bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));
const d = (v: Dec | string | number | null | undefined) => dec(v as string | number | null | undefined);

/** Everything that reads sales: lists, detail, POS settings, product rows, recent transactions. */
@Injectable()
export class SalesReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly register: CashRegisterService,
  ) {}

  // ================================================================================================ lists

  /** SellController@index: final sales with filters, sorting and totals for the filtered set. */
  async list(user: AuthUser, q: SaleListQueryDto) {
    const where = this.saleWhere(user, 'final', q);
    const sortKey = q.sortBy && SORTABLE[q.sortBy] ? q.sortBy : null;
    const dir = q.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy = sortKey ? Prisma.sql`${SORTABLE[sortKey]} ${dir}, t.id DESC` : Prisma.sql`t.transaction_date DESC, t.id DESC`;
    return this.runList(user, where, orderBy, q, true);
  }

  /** SellController@getDraftDatables for drafts (`quotation` false) or quotations (`quotation` true). */
  async listDrafts(user: AuthUser, q: DraftListQueryDto, quotation: boolean) {
    const where = this.saleWhere(user, 'draft', { ...q, quotation });
    const sortKey = q.sortBy && SORTABLE[q.sortBy] ? q.sortBy : null;
    const dir = q.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderBy = sortKey ? Prisma.sql`${SORTABLE[sortKey]} ${dir}, t.id DESC` : Prisma.sql`t.transaction_date DESC, t.id DESC`;
    return this.runList(user, where, orderBy, q, false);
  }

  private saleWhere(
    user: AuthUser,
    status: 'final' | 'draft',
    q: Partial<SaleListQueryDto> & { quotation?: boolean; search?: string; startDate?: string; endDate?: string; locationId?: number; contactId?: number; createdBy?: number },
  ): Prisma.Sql[] {
    const where: Prisma.Sql[] = [
      Prisma.sql`t.business_id = ${user.businessId}`,
      Prisma.sql`t.type = 'sell'`,
      Prisma.sql`t.status = ${status}`,
      Prisma.sql`(t.sub_type IS NULL OR t.sub_type <> 'project_invoice')`,
    ];
    if (status === 'draft' && q.quotation) where.push(Prisma.sql`t.sub_status = 'quotation'`);

    const vis = saleVisibility(user);
    if (vis.locationIds !== null) where.push(vis.locationIds.length === 0 ? Prisma.sql`1 = 0` : Prisma.sql`t.location_id IN (${Prisma.join(vis.locationIds)})`);
    if (status === 'final' && (vis.ownOnly || vis.commissionAgentOnly)) {
      const parts: Prisma.Sql[] = [];
      if (vis.ownOnly) parts.push(Prisma.sql`t.created_by = ${user.id}`);
      if (vis.commissionAgentOnly) parts.push(Prisma.sql`t.commission_agent = ${user.id}`);
      where.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
    }

    // users limited to paid / due / partial / overdue invoices only
    if (status === 'final' && !user.isAdmin && !user.isSuperadmin && !q.onlyShipments) {
      const allowed: string[] = [];
      if (can(user, 'view_paid_sells_only')) allowed.push('paid');
      if (can(user, 'view_due_sells_only')) allowed.push('due');
      if (can(user, 'view_partial_sells_only')) allowed.push('partial');
      const overdue = can(user, 'view_overdue_sells_only');
      if (allowed.length > 0 && overdue) where.push(Prisma.sql`(t.payment_status IN (${Prisma.join(allowed)}) OR (${this.overdueSql()}))`);
      else if (allowed.length > 0) where.push(Prisma.sql`t.payment_status IN (${Prisma.join(allowed)})`);
      else if (overdue) where.push(this.overdueSql());
    }

    if (q.paymentStatus === 'overdue') where.push(this.overdueSql());
    else if (q.paymentStatus) where.push(Prisma.sql`t.payment_status = ${q.paymentStatus}`);
    if (q.locationId) where.push(Prisma.sql`t.location_id = ${q.locationId}`);
    if (q.contactId) where.push(Prisma.sql`t.contact_id = ${q.contactId}`);
    if (q.createdBy) where.push(Prisma.sql`t.created_by = ${q.createdBy}`);
    if (q.commissionAgentId) where.push(Prisma.sql`t.commission_agent = ${q.commissionAgentId}`);
    if (q.shippingStatus) where.push(Prisma.sql`t.shipping_status = ${q.shippingStatus}`);
    if (q.onlyShipments) where.push(Prisma.sql`t.shipping_status IS NOT NULL`);
    if (q.typesOfServiceId) where.push(Prisma.sql`t.types_of_service_id = ${q.typesOfServiceId}`);
    if (q.resWaiterId) where.push(Prisma.sql`t.res_waiter_id = ${q.resWaiterId}`);
    if (q.isDirectSale === true) where.push(Prisma.sql`t.is_direct_sale = 1`);
    if (q.isDirectSale === false) where.push(Prisma.sql`t.is_direct_sale = 0 AND t.sub_type IS NULL`);
    if (q.isSuspend === true) where.push(Prisma.sql`t.is_suspend = 1`);
    if (q.isSuspend === false) where.push(Prisma.sql`t.is_suspend = 0`);
    if (q.paymentMethod) where.push(Prisma.sql`EXISTS (SELECT 1 FROM transaction_payments tpm WHERE tpm.transaction_id = t.id AND tpm.method = ${q.paymentMethod})`);
    // transaction_date holds the business-local wall clock, so local calendar days compare directly
    if (q.startDate) where.push(Prisma.sql`DATE(t.transaction_date) >= ${q.startDate.slice(0, 10)}`);
    if (q.endDate) where.push(Prisma.sql`DATE(t.transaction_date) <= ${q.endDate.slice(0, 10)}`);
    if (q.search) {
      const like = `%${ESCAPE(q.search)}%`;
      where.push(
        Prisma.sql`(t.invoice_no LIKE ${like} OR c.name LIKE ${like} OR c.supplier_business_name LIKE ${like} OR c.mobile LIKE ${like} OR c.contact_id LIKE ${like})`,
      );
    }
    return where;
  }

  private overdueSql(): Prisma.Sql {
    return Prisma.sql`t.payment_status IN ('due', 'partial') AND t.pay_term_number IS NOT NULL AND t.pay_term_type IS NOT NULL
      AND IF(t.pay_term_type = 'days', DATE_ADD(t.transaction_date, INTERVAL t.pay_term_number DAY) < CURDATE(), DATE_ADD(t.transaction_date, INTERVAL t.pay_term_number MONTH) < CURDATE())`;
  }

  private async runList(user: AuthUser, where: Prisma.Sql[], orderBy: Prisma.Sql, q: { page: number; perPage: number }, withTotals: boolean) {
    const whereSql = Prisma.join(where, ' AND ');
    const offset = (q.page - 1) * q.perPage;
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT t.id, t.invoice_no, t.transaction_date, t.status, t.sub_status, t.payment_status, t.final_total, t.total_before_tax, t.tax_amount,
             t.discount_type, t.discount_amount, t.shipping_status, t.shipping_charges, t.is_direct_sale, t.is_suspend, t.pay_term_number, t.pay_term_type,
             t.location_id, t.contact_id, t.created_by, t.commission_agent, t.types_of_service_id, t.res_table_id, t.rp_earned, t.rp_redeemed,
             t.additional_notes, t.staff_note,
             c.name AS contact_name, c.supplier_business_name, c.mobile AS contact_mobile, c.contact_id AS contact_code,
             bl.name AS location_name, ${ADDED_BY_SQL} AS added_by,
             ${PAID_SQL} AS total_paid,
             (SELECT COUNT(*) FROM transaction_sell_lines tsl WHERE tsl.transaction_id = t.id AND tsl.parent_sell_line_id IS NULL) AS total_items,
             (SELECT COALESCE(SUM(sr.final_total), 0) FROM transactions sr WHERE sr.return_parent_id = t.id) AS return_total,
             (SELECT COALESCE(SUM(tp2.amount), 0) FROM transaction_payments tp2 JOIN transactions sr2 ON sr2.id = tp2.transaction_id WHERE sr2.return_parent_id = t.id) AS return_paid
      FROM transactions t
      LEFT JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN business_locations bl ON bl.id = t.location_id
      LEFT JOIN users u ON u.id = t.created_by
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${q.perPage} OFFSET ${offset}`;

    const agg = await this.prisma.$queryRaw<Array<{ n: bigint | number; final_total: Dec | string; paid: Dec | string }>>`
      SELECT COUNT(*) AS n, COALESCE(SUM(t.final_total), 0) AS final_total, COALESCE(SUM(${PAID_SQL}), 0) AS paid
      FROM transactions t
      LEFT JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN business_locations bl ON bl.id = t.location_id
      WHERE ${whereSql}`;
    const total = Number(agg[0]?.n ?? 0);
    const finalTotal = d(agg[0]?.final_total);
    const paid = d(agg[0]?.paid);
    const now = new Date();

    const data = rows.map((r) => {
      const date = wallClockToInstant(r.transaction_date, user.timeZone);
      const finalAmount = d(r.final_total);
      const paidAmount = d(r.total_paid);
      return {
        id: Number(r.id),
        invoiceNo: r.invoice_no,
        transactionDate: date,
        status: r.status,
        subStatus: r.sub_status,
        paymentStatus: r.payment_status,
        displayPaymentStatus: displayPaymentStatus(r.payment_status, n(r.pay_term_number), r.pay_term_type, date, now),
        finalTotal: finalAmount.toFixed(),
        totalBeforeTax: d(r.total_before_tax).toFixed(),
        taxAmount: d(r.tax_amount).toFixed(),
        discountType: r.discount_type,
        discountAmount: d(r.discount_amount).toFixed(),
        shippingStatus: r.shipping_status,
        shippingCharges: d(r.shipping_charges).toFixed(),
        isDirectSale: bool(r.is_direct_sale),
        isSuspend: bool(r.is_suspend),
        locationId: n(r.location_id),
        locationName: r.location_name,
        contactId: n(r.contact_id),
        contactName: r.contact_name,
        supplierBusinessName: r.supplier_business_name,
        contactMobile: r.contact_mobile,
        contactCode: r.contact_code,
        createdBy: Number(r.created_by),
        addedBy: r.added_by,
        commissionAgent: n(r.commission_agent),
        typesOfServiceId: n(r.types_of_service_id),
        resTableId: n(r.res_table_id),
        rpEarned: Number(r.rp_earned),
        rpRedeemed: Number(r.rp_redeemed),
        saleNote: r.additional_notes,
        staffNote: r.staff_note,
        totalPaid: paidAmount.toFixed(),
        totalRemaining: finalAmount.sub(paidAmount).toFixed(),
        totalItems: Number(r.total_items),
        hasReturn: d(r.return_total).gt(0),
        returnTotal: d(r.return_total).toFixed(),
        returnDue: d(r.return_total).sub(d(r.return_paid)).toFixed(),
      };
    });

    const result = paginated(data, total, q);
    return {
      ...result,
      meta: { ...result.meta, ...(withTotals ? { totals: { finalTotal: finalTotal.toFixed(), totalPaid: paid.toFixed(), totalRemaining: finalTotal.sub(paid).toFixed() } } : {}) },
    };
  }

  // ================================================================================================ recent (POS screen)

  /** SellPosController@getRecentTransactions: the user's own latest POS sales / drafts / quotations. */
  async recent(user: AuthUser, q: RecentQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const status = q.status ?? 'final';
    const where: Prisma.transactionsWhereInput = { type: 'sell', created_by: user.id, is_direct_sale: false, sub_type: null };
    if (status === 'quotation') Object.assign(where, { status: 'draft', sub_status: 'quotation' });
    else if (status === 'draft') Object.assign(where, { status: 'draft', sub_status: null });
    else where.status = 'final';
    const rows = await db.transactions.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: q.limit ?? 10,
      select: { id: true, invoice_no: true, transaction_date: true, status: true, sub_status: true, final_total: true, payment_status: true, is_suspend: true, contact_id: true, res_table_id: true },
    });
    const ids = [...new Set(rows.flatMap((r) => (r.contact_id ? [r.contact_id] : [])))];
    const contacts = ids.length ? await db.contacts.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, supplier_business_name: true } }) : [];
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      transactionDate: r.transaction_date,
      status: r.status,
      subStatus: r.sub_status,
      paymentStatus: r.payment_status,
      isSuspend: r.is_suspend,
      finalTotal: r.final_total.toFixed(),
      contactId: r.contact_id,
      contactName: r.contact_id ? byId.get(r.contact_id)?.name ?? null : null,
      resTableId: r.res_table_id,
    }));
  }

  // ================================================================================================ detail

  /**
   * One sale for the detail screen and for loading into the edit form: header, lines (in the unit they were sold in, with the
   * product / variation / unit / tax), payments, returns and computed totals.
   */
  async get(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const sale = await db.transactions.findFirst({ where: { id, type: 'sell', ...(showOwnOnly(user) ? { created_by: user.id } : {}) } });
    if (!sale) throw new NotFoundException('Sale not found');
    const permitted = permittedLocations(user);
    if (permitted !== null && sale.location_id !== null && !permitted.includes(sale.location_id)) throw new NotFoundException('Sale not found');

    const [lines, payments, contact, location, orderTax, creator, returns] = await Promise.all([
      db.transaction_sell_lines.findMany({ where: { transaction_id: id }, orderBy: { id: 'asc' } }),
      db.transaction_payments.findMany({ where: { transaction_id: id }, orderBy: { id: 'asc' } }),
      sale.contact_id ? db.contacts.findFirst({ where: { id: sale.contact_id } }) : Promise.resolve(null),
      sale.location_id ? db.business_locations.findFirst({ where: { id: sale.location_id } }) : Promise.resolve(null),
      sale.tax_id ? db.tax_rates.findFirst({ where: { id: sale.tax_id } }) : Promise.resolve(null),
      db.users.findFirst({ where: { id: sale.created_by }, select: { id: true, surname: true, first_name: true, last_name: true } }),
      db.transactions.findMany({ where: { return_parent_id: id }, select: { id: true, invoice_no: true, final_total: true, transaction_date: true } }),
    ]);

    const productIds = [...new Set(lines.map((l) => l.product_id))];
    const variationIds = [...new Set(lines.map((l) => l.variation_id))];
    const [products, variations, taxes, stockRows] = await Promise.all([
      productIds.length ? db.products.findMany({ where: { id: { in: productIds } } }) : Promise.resolve([]),
      variationIds.length ? db.variations.findMany({ where: { id: { in: variationIds } }, select: { id: true, name: true, sub_sku: true, product_variation_id: true } }) : Promise.resolve([]),
      db.tax_rates.findMany({ select: { id: true, name: true, amount: true } }),
      sale.location_id && variationIds.length
        ? db.variation_location_details.findMany({ where: { location_id: sale.location_id, variation_id: { in: variationIds } }, select: { variation_id: true, qty_available: true } })
        : Promise.resolve([]),
    ]);
    const unitIds = [...new Set([...products.flatMap((p) => (p.unit_id ? [p.unit_id] : [])), ...lines.flatMap((l) => (l.sub_unit_id ? [l.sub_unit_id] : []))])];
    const baseUnitIds = [...new Set(products.flatMap((p) => (p.unit_id ? [p.unit_id] : [])))];
    const units = unitIds.length || baseUnitIds.length
      ? await db.units.findMany({ where: { OR: [{ id: { in: unitIds } }, { base_unit_id: { in: baseUnitIds } }] } })
      : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    const productById = new Map(products.map((p) => [p.id, p]));
    const variationById = new Map(variations.map((v) => [v.id, v]));
    const taxById = new Map(taxes.map((t) => [t.id, t]));
    const stockByVariation = new Map(stockRows.map((s) => [s.variation_id, s.qty_available]));
    const pvIds = [...new Set(variations.map((v) => v.product_variation_id))];
    const pvs = pvIds.length ? await this.prisma.product_variations.findMany({ where: { id: { in: pvIds } }, select: { id: true, is_dummy: true, name: true } }) : [];
    const pvById = new Map(pvs.map((p) => [p.id, p]));

    const lineView = (l: (typeof lines)[number]) => {
      const product = productById.get(l.product_id);
      const variation = variationById.get(l.variation_id);
      const pv = variation ? pvById.get(variation.product_variation_id) : undefined;
      const ownUnit = product?.unit_id ? unitById.get(product.unit_id) : undefined;
      const subUnit = l.sub_unit_id ? unitById.get(l.sub_unit_id) : undefined;
      const multiplier = subUnit ? unitMultiplier(product?.unit_id ?? null, l.sub_unit_id, subUnit.base_unit_multiplier) : new Prisma.Decimal(1);
      const rate = l.tax_id ? taxById.get(l.tax_id)?.amount ?? 0 : 0;
      const fixed = l.line_discount_type === 'fixed';
      const quantity = l.quantity.div(multiplier);
      const unitPriceIncTax = dec(l.unit_price_inc_tax).mul(multiplier);
      const subUnits = ownUnit
        ? [
            { id: ownUnit.id, name: ownUnit.actual_name, multiplier: '1', allowDecimal: ownUnit.allow_decimal },
            ...units.filter((u) => u.base_unit_id === ownUnit.id).map((u) => ({ id: u.id, name: u.actual_name, multiplier: dec(u.base_unit_multiplier).toFixed(), allowDecimal: u.allow_decimal })),
          ]
        : [];
      return {
        id: l.id,
        parentSellLineId: l.parent_sell_line_id,
        childrenType: l.children_type,
        productId: l.product_id,
        variationId: l.variation_id,
        productName: product?.name ?? null,
        variationName: pv && !pv.is_dummy ? variation?.name ?? null : null,
        productType: product?.type ?? null,
        sku: product?.sku ?? null,
        subSku: variation?.sub_sku ?? null,
        label: product ? productLabel(product.name, variation?.name, product.type !== 'variable', variation?.sub_sku) : `Product ${l.product_id}`,
        enableStock: product?.enable_stock ?? false,
        unit: ownUnit ? { id: ownUnit.id, shortName: ownUnit.short_name, allowDecimal: ownUnit.allow_decimal } : null,
        subUnitId: l.sub_unit_id,
        subUnitName: subUnit?.actual_name ?? null,
        subUnits,
        multiplier: multiplier.toFixed(),
        /** In the unit the line was sold in. */
        quantity: quantity.toFixed(),
        baseQuantity: l.quantity.toFixed(),
        unitPriceBeforeDiscount: l.unit_price_before_discount.mul(multiplier).toFixed(),
        unitPrice: dec(l.unit_price).mul(multiplier).toFixed(),
        lineDiscountType: l.line_discount_type,
        lineDiscountAmount: (fixed ? l.line_discount_amount.mul(multiplier) : l.line_discount_amount).toFixed(),
        taxId: l.tax_id,
        taxRate: String(rate),
        itemTax: l.item_tax.mul(multiplier).toFixed(),
        unitPriceIncTax: unitPriceIncTax.toFixed(),
        lineTotal: quantity.mul(unitPriceIncTax).toFixed(),
        sellLineNote: l.sell_line_note,
        lotNoLineId: l.lot_no_line_id,
        secondaryUnitQuantity: l.secondary_unit_quantity.toFixed(),
        quantityReturned: l.quantity_returned.div(multiplier).toFixed(),
        resServiceStaffId: l.res_service_staff_id,
        qtyAvailable: product?.enable_stock ? dec(stockByVariation.get(l.variation_id)).toFixed() : null,
      };
    };
    const lineViews = lines.map(lineView);
    const topLines = lineViews.filter((l) => !l.parentSellLineId);
    const paid = totalPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
    const subTotal = topLines.reduce((a, l) => a.add(dec(l.lineTotal)), ZERO);
    const discountValue = sale.discount_type === 'percentage' ? sale.total_before_tax.mul(dec(sale.discount_amount)).div(100) : sale.discount_type === 'fixed' ? dec(sale.discount_amount) : ZERO;
    const additionalExpenses = [1, 2, 3, 4]
      .map((i) => ({ key: sale[`additional_expense_key_${i}` as 'additional_expense_key_1'], value: sale[`additional_expense_value_${i}` as 'additional_expense_value_1'] }))
      .filter((a) => a.key || !a.value.isZero())
      .map((a) => ({ key: a.key, value: a.value.toFixed() }));
    const customer = contact
      ? {
          id: contact.id,
          name: contact.name,
          supplierBusinessName: contact.supplier_business_name,
          mobile: contact.mobile,
          contactCode: contact.contact_id,
          email: contact.email,
          addressLine1: contact.address_line_1,
          city: contact.city,
          isDefault: contact.is_default,
          balance: contact.balance.toFixed(),
          totalRp: contact.total_rp,
          creditLimit: contact.credit_limit === null ? null : contact.credit_limit.toFixed(),
        }
      : null;

    return {
      id: sale.id,
      invoiceNo: sale.invoice_no,
      type: sale.type,
      status: sale.status,
      subStatus: sale.sub_status,
      isQuotation: sale.is_quotation,
      isDirectSale: sale.is_direct_sale,
      isSuspend: sale.is_suspend,
      paymentStatus: sale.payment_status,
      displayPaymentStatus: displayPaymentStatus(sale.payment_status, sale.pay_term_number, sale.pay_term_type, sale.transaction_date, new Date()),
      transactionDate: sale.transaction_date,
      locationId: sale.location_id,
      location: location ? { id: location.id, name: location.name } : null,
      contactId: sale.contact_id,
      customer,
      customerGroupId: sale.customer_group_id,
      sellingPriceGroupId: sale.selling_price_group_id || null,
      commissionAgentId: sale.commission_agent,
      createdBy: sale.created_by,
      addedBy: creator ? [creator.surname, creator.first_name, creator.last_name].filter(Boolean).join(' ') : null,
      payTermNumber: sale.pay_term_number,
      payTermType: sale.pay_term_type,
      lines: lineViews,
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toFixed(),
        isReturn: p.is_return,
        paidOn: p.paid_on,
        paymentRefNo: p.payment_ref_no,
        note: p.note,
        cardTransactionNumber: p.card_transaction_number,
        cardNumber: p.card_number,
        cardType: p.card_type,
        cardHolderName: p.card_holder_name,
        cardMonth: p.card_month,
        cardYear: p.card_year,
        chequeNumber: p.cheque_number,
        bankAccountNumber: p.bank_account_number,
        transactionNo: p.transaction_no,
        accountId: p.account_id,
      })),
      totals: {
        subTotal: subTotal.toFixed(),
        totalBeforeTax: sale.total_before_tax.toFixed(),
        discountType: sale.discount_type,
        discountAmount: dec(sale.discount_amount).toFixed(),
        discountValue: discountValue.toFixed(),
        rpRedeemed: sale.rp_redeemed,
        rpRedeemedAmount: sale.rp_redeemed_amount.toFixed(),
        orderTaxId: sale.tax_id,
        orderTaxName: orderTax?.name ?? null,
        orderTaxRate: orderTax ? String(orderTax.amount) : null,
        taxAmount: sale.tax_amount.toFixed(),
        shippingCharges: sale.shipping_charges.toFixed(),
        packingCharge: dec(sale.packing_charge).toFixed(),
        packingChargeType: sale.packing_charge_type,
        additionalExpenses,
        roundOffAmount: sale.round_off_amount.toFixed(),
        finalTotal: sale.final_total.toFixed(),
        totalPaid: paid.toFixed(),
        totalDue: sale.final_total.sub(paid).toFixed(),
        rpEarned: sale.rp_earned,
      },
      shipping: {
        details: sale.shipping_details,
        address: sale.shipping_address,
        status: sale.shipping_status,
        deliveredTo: sale.delivered_to,
        deliveryPerson: sale.delivery_person === null ? null : Number(sale.delivery_person),
        customFields: [sale.shipping_custom_field_1, sale.shipping_custom_field_2, sale.shipping_custom_field_3, sale.shipping_custom_field_4, sale.shipping_custom_field_5],
      },
      saleNote: sale.additional_notes,
      staffNote: sale.staff_note,
      customFields: [sale.custom_field_1, sale.custom_field_2, sale.custom_field_3, sale.custom_field_4],
      exchangeRate: sale.exchange_rate.toFixed(),
      typesOfServiceId: sale.types_of_service_id,
      resTableId: sale.res_table_id,
      resWaiterId: sale.res_waiter_id,
      isKitchenOrder: sale.is_kitchen_order,
      returns: returns.map((r) => ({ id: r.id, invoiceNo: r.invoice_no, finalTotal: r.final_total.toFixed(), transactionDate: r.transaction_date })),
    };
  }

  // ================================================================================================ POS settings

  /** GET /sales/pos-settings: everything the POS and Add sale screens need to start. */
  async posSettings(user: AuthUser, q: PosSettingsQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const permitted = permittedLocations(user);
    const biz = await loadBusinessCtx(db, user);
    const business = await db.business.findUnique({
      where: { id: user.businessId },
      include: { currencies: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const [locations, taxRates, priceGroups, schemes, walkIn, accountsRows, agents] = await Promise.all([
      db.business_locations.findMany({ where: { deleted_at: null, is_active: true, ...(permitted ? { id: { in: permitted } } : {}) }, orderBy: { name: 'asc' } }),
      db.tax_rates.findMany({ where: { deleted_at: null, for_tax_group: false }, orderBy: { name: 'asc' } }),
      db.selling_price_groups.findMany({ where: { deleted_at: null, is_active: true }, orderBy: { name: 'asc' } }),
      db.invoice_schemes.findMany({ orderBy: { id: 'asc' } }),
      db.contacts.findFirst({ where: { is_default: true, deleted_at: null, type: { in: ['customer', 'both'] } }, select: { id: true, name: true, mobile: true, credit_limit: true } }),
      biz.modules.includes('account') ? db.accounts.findMany({ where: { deleted_at: null, is_closed: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
      biz.salesCmsnAgnt === 'user' || biz.salesCmsnAgnt === 'cmsn_agnt'
        ? db.users.findMany({
            where: { status: 'active', deleted_at: null, ...(biz.salesCmsnAgnt === 'cmsn_agnt' ? { is_cmmsn_agnt: true } : {}) },
            select: { id: true, surname: true, first_name: true, last_name: true },
            orderBy: { first_name: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    let customLabels: Record<string, unknown> = {};
    try {
      const parsed: unknown = business.custom_labels ? JSON.parse(business.custom_labels) : {};
      if (parsed && typeof parsed === 'object') customLabels = parsed as Record<string, unknown>;
    } catch {
      customLabels = {};
    }
    const paymentLabels = (customLabels.payments && typeof customLabels.payments === 'object' ? customLabels.payments : {}) as Record<string, string>;
    const methodLabel = (key: string, fallback: string) => (paymentLabels[key] && String(paymentLabels[key]).trim() ? String(paymentLabels[key]) : fallback);
    const allMethods = [
      { key: 'cash', label: 'Cash' },
      { key: 'card', label: 'Card' },
      { key: 'cheque', label: 'Cheque' },
      { key: 'bank_transfer', label: 'Bank Transfer' },
      { key: 'other', label: 'Other' },
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({ key: `custom_pay_${i}`, label: methodLabel(`custom_pay_${i}`, `Custom Payment ${i}`) })),
    ];

    const locationView = locations.map((l) => {
      let accounts: Record<string, { is_enabled?: unknown; account?: unknown }> = {};
      try {
        const parsed: unknown = l.default_payment_accounts ? JSON.parse(l.default_payment_accounts) : {};
        if (parsed && typeof parsed === 'object') accounts = parsed as typeof accounts;
      } catch {
        accounts = {};
      }
      const enabled = new Set(Object.entries(accounts).filter(([, v]) => v && (v.is_enabled === 1 || v.is_enabled === '1' || v.is_enabled === true)).map(([k]) => k));
      return {
        id: l.id,
        name: l.name,
        invoiceSchemeId: l.invoice_scheme_id,
        saleInvoiceSchemeId: l.sale_invoice_scheme_id,
        sellingPriceGroupId: l.selling_price_group_id,
        printReceiptOnInvoice: l.print_receipt_on_invoice ?? true,
        receiptPrinterType: l.receipt_printer_type,
        /** Payment methods switched on for this location, with the account each one posts to. */
        paymentMethods: allMethods
          .filter((m) => enabled.has(m.key))
          .map((m) => ({ key: m.key, label: m.label, accountId: accounts[m.key]?.account ? Number(accounts[m.key].account) : null })),
      };
    });

    let register: { id: number } | null = null;
    let registerKnown = true;
    try {
      register = await this.register.getOpenRegister(db, user);
    } catch {
      registerKnown = false;
    }

    const perms = {
      pos: linePermissions('pos'),
      direct: linePermissions('direct'),
    };
    const pos = biz.posSettings;
    return {
      business: {
        id: business.id,
        name: business.name,
        timeZone: biz.timeZone,
        currency: { symbol: business.currencies.symbol, code: business.currencies.code, thousandSeparator: business.currencies.thousand_separator, decimalSeparator: business.currencies.decimal_separator },
        currencySymbolPlacement: business.currency_symbol_placement,
        currencyPrecision: business.currency_precision,
        quantityPrecision: business.quantity_precision,
        sellPriceTax: business.sell_price_tax,
        enableInlineTax: business.enable_inline_tax,
        itemAdditionMethod: business.item_addition_method,
        enableSubUnits: business.enable_sub_units,
        enableLotNumber: business.enable_lot_number,
        enableProductExpiry: business.enable_product_expiry,
        onProductExpiry: business.on_product_expiry,
        stopSellingBefore: business.stop_selling_before,
        enableBrand: business.enable_brand,
        enableCategory: business.enable_category,
        accountingMethod: business.accounting_method,
        salesCmsnAgnt: business.sales_cmsn_agnt,
        defaultSalesTaxId: business.default_sales_tax,
        defaultSalesDiscount: business.default_sales_discount === null ? null : business.default_sales_discount.toFixed(),
        transactionEditDays: business.transaction_edit_days,
        enabledModules: biz.modules,
        dateFormat: business.date_format,
        timeFormat: business.time_format,
        rewardPoints: {
          enabled: business.enable_rp,
          name: business.rp_name,
          amountForUnitRp: business.amount_for_unit_rp.toFixed(),
          minOrderTotalForRp: business.min_order_total_for_rp.toFixed(),
          maxRpPerOrder: business.max_rp_per_order,
          redeemAmountPerUnitRp: business.redeem_amount_per_unit_rp.toFixed(),
          minOrderTotalForRedeem: business.min_order_total_for_redeem.toFixed(),
          minRedeemPoint: business.min_redeem_point,
          maxRedeemPoint: business.max_redeem_point,
        },
      },
      /** business.pos_settings (Laravel keys, merged with the defaults of BusinessUtil::defaultPosSettings). */
      posSettings: { ...pos, allow_overselling: !!biz.allowOverselling, amount_rounding_method: biz.roundingMultiple.isZero() ? null : biz.roundingMultiple.toFixed() },
      keyboardShortcuts: business.keyboard_shortcuts ? this.safeJson(business.keyboard_shortcuts) : null,
      permissions: {
        canSell: can(user, 'sell.create'),
        canDirectSell: can(user, 'direct_sell.access'),
        canUpdate: can(user, 'sell.update'),
        canDelete: can(user, 'sell.delete'),
        canTakePayments: can(user, 'sell.payments'),
        canDiscount: can(user, 'discount.access'),
        canShip: can(user, 'access_shipping'),
        canPrint: can(user, 'print_invoice'),
        canListDrafts: can(user, 'list_drafts'),
        canListQuotations: can(user, 'list_quotations'),
        canViewRegister: can(user, 'view_cash_register'),
        canCloseRegister: can(user, 'close_cash_register'),
        canEditPrice: { pos: can(user, perms.pos.price), direct: can(user, perms.direct.price) },
        canEditLineDiscount: { pos: can(user, perms.pos.discount), direct: can(user, perms.direct.discount) },
        canSeeDefaultSellingPrice: can(user, 'access_default_selling_price'),
      },
      locations: locationView,
      defaultLocationId: q.locationId && locationView.some((l) => l.id === q.locationId) ? q.locationId : locationView[0]?.id ?? null,
      paymentMethods: allMethods,
      taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, rate: String(t.amount), isTaxGroup: t.is_tax_group })),
      sellingPriceGroups: priceGroups.map((g) => ({ id: g.id, name: g.name })),
      invoiceSchemes: schemes.map((s) => ({ id: s.id, name: s.name, isDefault: s.is_default })),
      walkInCustomer: walkIn ? { id: walkIn.id, name: walkIn.name, mobile: walkIn.mobile, creditLimit: walkIn.credit_limit === null ? null : walkIn.credit_limit.toFixed() } : null,
      accounts: accountsRows,
      commissionAgents: agents.map((a) => ({ id: a.id, name: [a.surname, a.first_name, a.last_name].filter(Boolean).join(' ') })),
      shippingStatuses: SHIPPING_STATUSES,
      cashRegister: { known: registerKnown, open: !!register, registerId: register?.id ?? null },
    };
  }

  private safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ================================================================================================ product row

  /**
   * SellPosController@getProductRow: the defaults for adding a variation to a sale (prices for the chosen price group and
   * customer group, tax, units, stock, lots, combo components) and the line maths already applied.
   */
  async productRow(user: AuthUser, q: ProductRowQueryDto) {
    const permitted = permittedLocations(user);
    if (permitted !== null && !permitted.includes(q.locationId)) throw new ForbiddenException('You cannot sell from this location');
    const db = this.prisma.forTenant(user.businessId);
    const biz = await loadBusinessCtx(db, user);

    const variation = await db.variations.findFirst({ where: { id: q.variationId, deleted_at: null }, include: { products: true } });
    if (!variation || variation.products.business_id !== user.businessId) throw new NotFoundException('Product not found');
    const product = variation.products;
    if (product.is_inactive) throw new BadRequestException('This product is inactive');

    const [pv, unit, vld, taxRow] = await Promise.all([
      this.prisma.product_variations.findUnique({ where: { id: variation.product_variation_id }, select: { is_dummy: true, name: true } }),
      product.unit_id ? db.units.findFirst({ where: { id: product.unit_id } }) : Promise.resolve(null),
      db.variation_location_details.findFirst({ where: { variation_id: variation.id, location_id: q.locationId }, select: { qty_available: true } }),
      product.tax ? db.tax_rates.findFirst({ where: { id: product.tax } }) : Promise.resolve(null),
    ]);

    // combo components and combo stock
    const defs = product.type === 'combo' ? parseComboComponents(variation.combo_variations) : [];
    const compVariations = defs.length ? await db.variations.findMany({ where: { id: { in: defs.map((c) => c.variationId) }, deleted_at: null }, include: { products: true } }) : [];
    const compById = new Map(compVariations.map((c) => [c.id, c]));
    const compUnits = defs.length ? await db.units.findMany({ where: { id: { in: defs.flatMap((c) => (c.unitId ? [c.unitId] : [])) } } }) : [];
    const compUnitById = new Map(compUnits.map((u) => [u.id, u]));
    const compStock = defs.length
      ? await db.variation_location_details.findMany({ where: { location_id: q.locationId, variation_id: { in: defs.map((c) => c.variationId) } }, select: { variation_id: true, qty_available: true } })
      : [];
    const compStockById = new Map(compStock.map((s) => [s.variation_id, s.qty_available]));
    let comboQty: Dec | null = null;
    const components = defs.map((c) => {
      const cv = compById.get(c.variationId);
      if (!cv) throw new BadRequestException(`A component of ${product.name} no longer exists`);
      const cu = c.unitId ? compUnitById.get(c.unitId) : undefined;
      const m = cu && cu.base_unit_id === cv.products.unit_id ? unitMultiplier(cv.products.unit_id, c.unitId, cu.base_unit_multiplier) : new Prisma.Decimal(1);
      const required = c.quantity.mul(m);
      if (cv.products.enable_stock && !required.isZero()) {
        const possible = dec(compStockById.get(cv.id)).div(required).floor();
        comboQty = comboQty === null ? possible : Prisma.Decimal.min(comboQty, possible);
      }
      return { productId: cv.product_id, variationId: cv.id, name: cv.products.name, enableStock: cv.products.enable_stock, quantityRequired: required.toFixed() };
    });

    const enableStock = product.enable_stock;
    const qtyAvailable: Dec = product.type === 'combo' ? comboQty ?? ZERO : dec(vld?.qty_available);
    if (!q.isDraft && !biz.allowOverselling && enableStock && qtyAvailable.lte(0) && product.type !== 'combo') {
      throw new BadRequestException({ message: `${product.name} is out of stock`, code: 'OUT_OF_STOCK' });
    }
    if (!q.isDraft && !biz.allowOverselling && product.type === 'combo' && components.some((c) => c.enableStock) && qtyAvailable.lte(0)) {
      throw new BadRequestException({ message: `${product.name} is out of stock`, code: 'OUT_OF_STOCK' });
    }

    // price: selling price group price, then the customer group percentage
    const taxRate = taxRow ? new Prisma.Decimal(String(taxRow.amount)) : ZERO;
    let contactGroup: { id: number; percent: Dec; priceGroupId: number | null } | null = null;
    if (q.contactId) {
      const contact = await db.contacts.findFirst({ where: { id: q.contactId }, select: { customer_group_id: true } });
      if (contact?.customer_group_id) {
        const cg = await db.customer_groups.findFirst({ where: { id: contact.customer_group_id } });
        if (cg) {
          contactGroup = {
            id: cg.id,
            percent: cg.price_calculation_type === 'percentage' && cg.amount ? new Prisma.Decimal(String(cg.amount)) : ZERO,
            priceGroupId: cg.price_calculation_type === 'selling_price_group' ? cg.selling_price_group_id : null,
          };
        }
      }
    }
    const priceGroupId = q.priceGroupId ?? contactGroup?.priceGroupId ?? null;
    let groupExc: Dec | null = null;
    if (priceGroupId) {
      const gp = await db.variation_group_prices.findFirst({ where: { variation_id: variation.id, price_group_id: priceGroupId } });
      if (gp) groupExc = groupPriceFor(gp.price_type, gp.price_inc_tax, variation.sell_price_inc_tax, taxRate).excTax;
    }
    const unitPrice = expectedUnitPriceExcTax(variation.default_sell_price, groupExc, contactGroup?.percent ?? ZERO);
    const sellPriceIncTax = groupExc ? groupExc.mul(taxRate.add(100)).div(100) : customerGroupPrice(dec(variation.sell_price_inc_tax), contactGroup?.percent ?? ZERO);

    const taxId = biz.enableInlineTax && taxRow ? taxRow.id : null;
    const quantity = q.quantity !== undefined ? dec(q.quantity) : new Prisma.Decimal(1);
    const calc = calculateLine({ quantity, unitPrice, discountType: 'fixed', discountAmount: 0, taxRate: taxId ? taxRate : null }, biz.currencyPrecision);

    // sub-units the product allows
    const allowed = parseIdList(product.sub_unit_ids);
    const subUnitRows = unit ? await db.units.findMany({ where: { base_unit_id: unit.id, deleted_at: null }, orderBy: { actual_name: 'asc' } }) : [];
    const subUnits = unit
      ? [
          ...(allowed.length === 0 || allowed.includes(unit.id) || subUnitRows.length === 0 ? [{ id: unit.id, name: unit.actual_name, multiplier: '1', allowDecimal: unit.allow_decimal }] : []),
          ...subUnitRows.filter((u) => allowed.length === 0 || allowed.includes(u.id)).map((u) => ({ id: u.id, name: u.actual_name, multiplier: dec(u.base_unit_multiplier).toFixed(), allowDecimal: u.allow_decimal })),
        ]
      : [];

    // lots (lot number / expiry businesses)
    let lots: Array<{ purchaseLineId: number; lotNumber: string | null; expDate: string | null; qtyAvailable: string }> = [];
    if ((biz.enableProductExpiry || (await this.lotsEnabled(user))) && enableStock) {
      const cutoff = stopSellingCutoffDay(biz);
      const rows = await this.prisma.$queryRaw<Array<{ id: number | bigint; lot_number: string | null; exp_date: Date | null; available: Dec | string }>>`
        SELECT pl.id, pl.lot_number, pl.exp_date,
               (pl.quantity - (pl.quantity_sold + pl.quantity_adjusted + pl.quantity_returned + pl.mfg_quantity_used)) AS available
        FROM purchase_lines pl JOIN transactions t ON t.id = pl.transaction_id
        WHERE t.business_id = ${user.businessId} AND t.location_id = ${q.locationId}
          AND t.type IN ('purchase', 'purchase_transfer', 'opening_stock', 'production_purchase') AND t.status = 'received'
          AND pl.variation_id = ${variation.id}
          AND (pl.quantity_sold + pl.quantity_adjusted + pl.quantity_returned + pl.mfg_quantity_used) < pl.quantity
          ${cutoff ? Prisma.sql`AND (pl.exp_date IS NULL OR pl.exp_date > ${cutoff})` : Prisma.empty}
        ORDER BY pl.exp_date IS NULL, pl.exp_date ASC, pl.id ASC`;
      lots = rows.map((r) => ({ purchaseLineId: Number(r.id), lotNumber: r.lot_number, expDate: r.exp_date ? r.exp_date.toISOString().slice(0, 10) : null, qtyAvailable: d(r.available).toFixed() }));
    }

    const screen = q.isDirectSale ? 'direct' : 'pos';
    const perms = linePermissions(screen);
    return {
      productId: product.id,
      variationId: variation.id,
      productName: product.name,
      variationName: pv && !pv.is_dummy ? variation.name : null,
      label: productLabel(product.name, variation.name, !!pv?.is_dummy, variation.sub_sku),
      sku: product.sku,
      subSku: variation.sub_sku,
      productType: product.type,
      enableStock,
      qtyAvailable: enableStock || product.type === 'combo' ? qtyAvailable.toFixed() : null,
      unit: unit ? { id: unit.id, shortName: unit.short_name, allowDecimal: unit.allow_decimal } : null,
      subUnits,
      taxId,
      taxRate: taxId ? taxRate.toFixed() : '0',
      /** Selling price per unit excluding tax (what the line's unitPrice starts as). */
      unitPrice: unitPrice.toFixed(),
      /** Default selling price including the product's tax. */
      sellPriceIncTax: sellPriceIncTax.toFixed(),
      quantity: quantity.toFixed(),
      lineDiscountType: 'fixed',
      lineDiscountAmount: '0',
      unitPriceIncTax: calc.unitPriceIncTax.toFixed(),
      itemTax: calc.itemTax.toFixed(),
      lineTotal: calc.lineTotal.toFixed(),
      customerGroupId: contactGroup?.id ?? null,
      appliedPriceGroupId: priceGroupId,
      components,
      lots,
      warrantyId: product.warranty_id,
      canEditPrice: can(user, perms.price),
      canEditDiscount: can(user, perms.discount),
    };
  }

  private async lotsEnabled(user: AuthUser): Promise<boolean> {
    const b = await this.prisma.business.findUnique({ where: { id: user.businessId }, select: { enable_lot_number: true } });
    return !!b?.enable_lot_number;
  }
}

export type SaleDetail = Awaited<ReturnType<SalesReadService['get']>>;
