import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type transaction_sell_lines } from '@prisma/client';
import { can } from '../../common/can';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { formatReferenceNumber, prefixFor } from '../../common/reference-number';
import type { TenantDb, TenantTx } from '../../common/tenant-db';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { permittedLocationIds } from '../settings/locations/location-access';
import { LookupQueryDto, ReturnableSalesQueryDto, ReturnPaymentDto, SaveSellReturnDto, SellReturnListQueryDto } from './sell-return.dto';
import {
  assertLocationPermitted,
  assertReturnableSale,
  assertTotalsSane,
  calculatePaymentStatus,
  computeReturnTotals,
  dayRange,
  dec,
  discountFromStored,
  displayQuantity,
  groupTaxBreakdown,
  hasReturnedQuantity,
  netPaid,
  normalizeDiscount,
  planMappingChange,
  resolveReturnQuantities,
  returnAccessScope,
  rewardAdjustmentForReturn,
  saleVisibilityScope,
  str,
  stockChange,
  validateRefundPayment,
  type CanFn,
  type Dec,
  type SaleLineFacts,
  type SellPurchaseMapping,
} from './sell-return.rules';

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const RETURN_SORTABLE = ['transaction_date', 'invoice_no', 'final_total', 'payment_status', 'id'] as const;
const SALE_SORTABLE = ['transaction_date', 'invoice_no', 'final_total', 'id'] as const;

interface LineInfo {
  line: transaction_sell_lines;
  productName: string;
  productType: string | null;
  sku: string;
  variationName: string;
  unitName: string;
  allowDecimal: boolean;
  multiplier: Dec;
  enableStock: boolean;
  productVariationId: number;
}

@Injectable()
export class SellReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  private canFn(user: AuthUser): CanFn {
    return (p) => can(user, p);
  }

  // ------------------------------------------------------------------------------------------------ list

  /** Laravel `SellReturnController@index`: returns of the business, newest first, with the parent sale and the paid amount. */
  async list(user: AuthUser, q: SellReturnListQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = await this.returnWhere(db, user, q);

    const [rows, total, sums, ids] = await Promise.all([
      db.transactions.findMany({
        where,
        orderBy: orderBy(q, RETURN_SORTABLE, 'transaction_date'),
        ...skipTake(q),
        include: {
          contacts: { select: { id: true, name: true, supplier_business_name: true, mobile: true } },
          business_locations: { select: { id: true, name: true } },
        },
      }),
      db.transactions.count({ where }),
      db.transactions.aggregate({ where, _sum: { final_total: true } }),
      db.transactions.findMany({ where, select: { id: true } }),
    ]);

    const parentIds = rows.map((r) => r.return_parent_id).filter((v): v is number => v !== null);
    const [parents, paidByReturn, paidAll] = await Promise.all([
      parentIds.length ? db.transactions.findMany({ where: { id: { in: parentIds } }, select: { id: true, invoice_no: true } }) : [],
      this.paidByTransaction(rows.map((r) => r.id)),
      this.paidTotal(ids.map((r) => r.id)),
    ]);
    const parentById = new Map(parents.map((p) => [p.id, p.invoice_no]));

    const data = rows.map((r) => {
      const paid = paidByReturn.get(r.id) ?? dec(0);
      return {
        id: r.id,
        invoiceNo: r.invoice_no,
        transactionDate: r.transaction_date,
        contactId: r.contact_id,
        customerName: r.contacts?.name ?? null,
        supplierBusinessName: r.contacts?.supplier_business_name ?? null,
        mobile: r.contacts?.mobile ?? null,
        locationId: r.location_id,
        locationName: r.business_locations?.name ?? null,
        parentSaleId: r.return_parent_id,
        parentSaleInvoiceNo: r.return_parent_id !== null ? parentById.get(r.return_parent_id) ?? null : null,
        totalBeforeTax: str(r.total_before_tax),
        taxAmount: str(r.tax_amount),
        finalTotal: str(r.final_total),
        paymentStatus: r.payment_status,
        amountPaid: str(paid),
        paymentDue: str(dec(r.final_total).sub(paid)),
        createdBy: r.created_by,
        timeZone: user.timeZone,
      };
    });

    const finalSum = dec(sums._sum.final_total);
    return {
      ...paginated(data, total, q),
      totals: { finalTotal: str(finalSum), amountPaid: str(paidAll), paymentDue: str(finalSum.sub(paidAll)) },
    };
  }

  private async returnWhere(db: TenantDb, user: AuthUser, q: SellReturnListQueryDto): Promise<Prisma.transactionsWhereInput> {
    const c = this.canFn(user);
    const scope = returnAccessScope(c);
    if (!scope) throw new ForbiddenException('You do not have permission to view sell returns');

    const and: Prisma.transactionsWhereInput[] = [{ type: 'sell_return', status: 'final' }];
    const permitted = permittedLocationIds(user);
    if (permitted !== 'all') and.push({ location_id: { in: permitted } });
    if (scope === 'own') and.push({ created_by: user.id });
    if (q.createdBy) and.push({ created_by: q.createdBy });
    if (q.locationId) and.push({ location_id: q.locationId });
    if (q.customerId) and.push({ contact_id: q.customerId });
    if (q.paymentStatus) and.push({ payment_status: q.paymentStatus });
    if (q.saleId) and.push({ return_parent_id: q.saleId });
    const range = dayRange(q.startDate, q.endDate, user.timeZone);
    if (range.gte || range.lt) and.push({ transaction_date: range });

    // A user who may only see their own sales also only sees the returns of those sales.
    if (saleVisibilityScope(c) === 'own') {
      const own = await db.transactions.findMany({ where: { type: 'sell', created_by: user.id }, select: { id: true } });
      and.push({ return_parent_id: { in: own.map((s) => s.id) } });
    }

    if (q.search) {
      const s = q.search.trim();
      const parents = await db.transactions.findMany({ where: { type: 'sell', invoice_no: { contains: s } }, select: { id: true }, take: 500 });
      and.push({
        OR: [
          { invoice_no: { contains: s } },
          { return_parent_id: { in: parents.map((p) => p.id) } },
          { contacts: { OR: [{ name: { contains: s } }, { supplier_business_name: { contains: s } }, { mobile: { contains: s } }] } },
        ],
      });
    }
    return { AND: and };
  }

  /** Sum of `transaction_payments.amount` per transaction (Laravel list: `SUM(TP.amount)`, is_return not considered). */
  private async paidByTransaction(ids: number[]): Promise<Map<number, Dec>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.transaction_payments.groupBy({ by: ['transaction_id'], where: { transaction_id: { in: ids } }, _sum: { amount: true } });
    return new Map(rows.filter((r) => r.transaction_id !== null).map((r) => [r.transaction_id as number, dec(r._sum.amount)]));
  }

  private async paidTotal(ids: number[]): Promise<Dec> {
    let total = dec(0);
    for (let i = 0; i < ids.length; i += 5000) {
      const part = await this.prisma.transaction_payments.aggregate({ where: { transaction_id: { in: ids.slice(i, i + 5000) } }, _sum: { amount: true } });
      total = total.add(dec(part._sum.amount));
    }
    return total;
  }

  // ------------------------------------------------------------------------------------------------ sales picker

  /** Final sales the user can return, with the existing return (if any). Replaces Laravel's "sell return" action on the sales list. */
  async returnableSales(user: AuthUser, q: ReturnableSalesQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const c = this.canFn(user);
    const and: Prisma.transactionsWhereInput[] = [{ type: 'sell', status: 'final' }, ...this.saleScope(user, c)];
    if (q.locationId) and.push({ location_id: q.locationId });
    if (q.customerId) and.push({ contact_id: q.customerId });
    const range = dayRange(q.startDate, q.endDate, user.timeZone);
    if (range.gte || range.lt) and.push({ transaction_date: range });
    if (q.search) {
      const s = q.search.trim();
      and.push({ OR: [{ invoice_no: { contains: s } }, { contacts: { OR: [{ name: { contains: s } }, { supplier_business_name: { contains: s } }, { mobile: { contains: s } }] } }] });
    }
    const where: Prisma.transactionsWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      db.transactions.findMany({
        where,
        orderBy: orderBy(q, SALE_SORTABLE, 'transaction_date'),
        ...skipTake(q),
        include: {
          contacts: { select: { name: true, supplier_business_name: true, mobile: true } },
          business_locations: { select: { name: true } },
        },
      }),
      db.transactions.count({ where }),
    ]);
    const returns = rows.length
      ? await db.transactions.findMany({ where: { type: 'sell_return', return_parent_id: { in: rows.map((r) => r.id) } }, select: { id: true, return_parent_id: true, final_total: true, invoice_no: true } })
      : [];
    const byParent = new Map(returns.map((r) => [r.return_parent_id, r]));

    return paginated(
      rows.map((r) => {
        const ret = byParent.get(r.id);
        return {
          id: r.id,
          invoiceNo: r.invoice_no,
          transactionDate: r.transaction_date,
          customerName: r.contacts?.name ?? null,
          supplierBusinessName: r.contacts?.supplier_business_name ?? null,
          mobile: r.contacts?.mobile ?? null,
          locationName: r.business_locations?.name ?? null,
          finalTotal: str(r.final_total),
          paymentStatus: r.payment_status,
          returnId: ret?.id ?? null,
          returnInvoiceNo: ret?.invoice_no ?? null,
          returnTotal: ret ? str(ret.final_total) : null,
          timeZone: user.timeZone,
        };
      }),
      total,
      q,
    );
  }

  /** Location + ownership filters for sales (Laravel `validateInvoiceToReturn`). */
  private saleScope(user: AuthUser, c: CanFn): Prisma.transactionsWhereInput[] {
    const f: Prisma.transactionsWhereInput[] = [];
    const permitted = permittedLocationIds(user);
    if (permitted !== 'all') f.push({ location_id: { in: permitted } });
    if (saleVisibilityScope(c) === 'own') f.push({ created_by: user.id });
    return f;
  }

  // ------------------------------------------------------------------------------------------------ lookup (the return form)

  /**
   * Finds the sale by invoice number or id and returns everything the return form needs: the sale, its lines with units,
   * quantity sold / already returned / still returnable (all in the unit shown on the sale line), the current return if
   * one exists, and the discount/tax defaults (Laravel pre-fills the return's own values, else the sale's).
   */
  async lookup(user: AuthUser, q: LookupQueryDto) {
    const hasInvoice = !!q.invoiceNo?.trim();
    if (hasInvoice === (q.saleId !== undefined)) throw new BadRequestException('Give either invoiceNo or saleId');
    const db = this.prisma.forTenant(user.businessId);
    const c = this.canFn(user);
    if (!returnAccessScope(c)) throw new ForbiddenException('You do not have permission to create sell returns');

    const sale = await db.transactions.findFirst({
      where: { AND: [{ type: 'sell', status: 'final' }, hasInvoice ? { invoice_no: q.invoiceNo?.trim() } : { id: q.saleId }, ...this.saleScope(user, c)] },
      orderBy: { id: 'asc' },
      include: {
        contacts: { select: { id: true, name: true, supplier_business_name: true, mobile: true } },
        business_locations: { select: { id: true, name: true } },
        tax_rates: { select: { id: true, name: true, amount: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const existing = await db.transactions.findFirst({ where: { type: 'sell_return', return_parent_id: sale.id } });
    const infos = await this.lineInfos(db, sale.id);

    const taxRate = sale.tax_rates ? dec(String(sale.tax_rates.amount)) : dec(0);
    const defaultType = existing?.discount_type ?? sale.discount_type ?? '';
    const defaultAmount = existing ? existing.discount_amount : sale.discount_amount;

    return {
      sale: {
        id: sale.id,
        invoiceNo: sale.invoice_no,
        transactionDate: sale.transaction_date,
        locationId: sale.location_id,
        locationName: sale.business_locations?.name ?? null,
        contactId: sale.contact_id,
        customerName: sale.contacts?.name ?? null,
        supplierBusinessName: sale.contacts?.supplier_business_name ?? null,
        mobile: sale.contacts?.mobile ?? null,
        totalBeforeTax: str(sale.total_before_tax),
        taxAmount: str(sale.tax_amount),
        finalTotal: str(sale.final_total),
        discountType: sale.discount_type,
        discountAmount: str(sale.discount_amount),
        paymentStatus: sale.payment_status,
        taxId: sale.tax_id,
        taxName: sale.tax_rates?.name ?? null,
        taxRate: str(taxRate),
      },
      existingReturn: existing
        ? {
            id: existing.id,
            invoiceNo: existing.invoice_no,
            transactionDate: existing.transaction_date,
            discountType: existing.discount_type,
            discountAmount: str(existing.discount_amount),
            totalBeforeTax: str(existing.total_before_tax),
            taxAmount: str(existing.tax_amount),
            finalTotal: str(existing.final_total),
            paymentStatus: existing.payment_status,
          }
        : null,
      form: {
        invoiceNo: existing?.invoice_no ?? null,
        transactionDate: existing?.transaction_date ?? new Date(),
        discountType: defaultType,
        discountAmount: str(defaultAmount),
        taxId: sale.tax_id,
        taxName: sale.tax_rates?.name ?? null,
        taxRate: str(taxRate),
      },
      lines: infos.map((i) => this.lineView(i)),
      timeZone: user.timeZone,
    };
  }

  private lineView(i: LineInfo) {
    const qty = displayQuantity(dec(i.line.quantity), i.multiplier);
    const returned = displayQuantity(dec(i.line.quantity_returned), i.multiplier);
    return {
      sellLineId: i.line.id,
      productId: i.line.product_id,
      variationId: i.line.variation_id,
      productName: i.productName,
      productType: i.productType,
      variationName: i.variationName,
      sku: i.sku,
      unitName: i.unitName,
      allowDecimal: i.allowDecimal,
      multiplier: str(i.multiplier),
      unitPriceIncTax: str(dec(i.line.unit_price_inc_tax).mul(i.multiplier)),
      quantity: str(qty),
      quantityReturned: str(returned),
      returnable: str(displayQuantity(dec(i.line.quantity).sub(dec(i.line.quantity_returned)), i.multiplier)),
      enableStock: i.enableStock,
    };
  }

  /** Lines of a sale with product, variation and unit names (sub unit aware). */
  private async lineInfos(db: TenantTx, saleId: number, onlyReturned = false): Promise<LineInfo[]> {
    const lines = await db.transaction_sell_lines.findMany({
      where: { transaction_id: saleId, ...(onlyReturned ? { quantity_returned: { gt: 0 } } : {}) },
      orderBy: { id: 'asc' },
      include: {
        products: { select: { name: true, type: true, sku: true, unit_id: true, enable_stock: true } },
        variations: { select: { name: true, sub_sku: true, product_variation_id: true } },
      },
    });
    const unitIds = new Set<number>();
    const pvIds = new Set<number>();
    for (const l of lines) {
      if (l.sub_unit_id) unitIds.add(l.sub_unit_id);
      if (l.products.unit_id) unitIds.add(l.products.unit_id);
      pvIds.add(l.variations.product_variation_id);
    }
    const [units, pvs] = await Promise.all([
      unitIds.size ? db.units.findMany({ where: { id: { in: [...unitIds] } } }) : [],
      pvIds.size ? this.prisma.product_variations.findMany({ where: { id: { in: [...pvIds] } }, select: { id: true, name: true } }) : [],
    ]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    const pvById = new Map(pvs.map((p) => [p.id, p.name]));

    return lines.map((l) => {
      const sub = l.sub_unit_id ? unitById.get(l.sub_unit_id) : undefined;
      const base = l.products.unit_id ? unitById.get(l.products.unit_id) : undefined;
      const unit = sub ?? base;
      // Laravel: decimals are refused when the product unit does not allow them; a sub unit's own flag overrides.
      const allowDecimal = sub ? sub.allow_decimal : base ? base.allow_decimal : true;
      const multiplier = sub?.base_unit_multiplier ? dec(sub.base_unit_multiplier) : dec(1);
      const isVariable = l.products.type === 'variable';
      return {
        line: l,
        productName: l.products.name,
        productType: l.products.type,
        sku: l.variations.sub_sku ?? l.products.sku,
        variationName: isVariable ? `${pvById.get(l.variations.product_variation_id) ?? ''} - ${l.variations.name}` : '',
        unitName: unit?.short_name ?? '',
        allowDecimal,
        multiplier,
        enableStock: l.products.enable_stock,
        productVariationId: l.variations.product_variation_id,
      };
    });
  }

  // ------------------------------------------------------------------------------------------------ detail

  async get(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const ret = await this.findReturn(db, user, id);
    const [parent, contact, location, business, tax, infos, payments, taxSubs] = await Promise.all([
      ret.return_parent_id ? db.transactions.findFirst({ where: { id: ret.return_parent_id } }) : null,
      ret.contact_id ? db.contacts.findFirst({ where: { id: ret.contact_id } }) : null,
      ret.location_id ? db.business_locations.findFirst({ where: { id: ret.location_id } }) : null,
      this.prisma.business.findUnique({ where: { id: user.businessId }, select: { name: true } }),
      ret.tax_id ? db.tax_rates.findFirst({ where: { id: ret.tax_id } }) : null,
      ret.return_parent_id ? this.lineInfos(db, ret.return_parent_id, true) : [],
      this.prisma.transaction_payments.findMany({ where: { transaction_id: ret.id }, orderBy: { id: 'asc' } }),
      ret.tax_id ? this.subTaxes(ret.tax_id) : [],
    ]);

    const paid = netPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
    const lines = infos.map((i) => {
      const returned = displayQuantity(dec(i.line.quantity_returned), i.multiplier);
      const price = dec(i.line.unit_price_inc_tax).mul(i.multiplier);
      return {
        sellLineId: i.line.id,
        productName: i.productName,
        variationName: i.variationName,
        sku: i.sku,
        unitName: i.unitName,
        unitPriceIncTax: str(price),
        quantityReturned: str(returned),
        lineTotal: str(dec(i.line.unit_price_inc_tax).mul(i.line.quantity_returned)),
      };
    });
    const addressParts = (o: { landmark?: string | null; city?: string | null; state?: string | null; country?: string | null; zip_code?: string | null } | null) =>
      o ? [o.landmark, o.city, o.state, o.zip_code, o.country].filter((v): v is string => !!v && v.trim() !== '').join(', ') : '';

    return {
      id: ret.id,
      invoiceNo: ret.invoice_no,
      transactionDate: ret.transaction_date,
      paymentStatus: ret.payment_status,
      totalBeforeTax: str(ret.total_before_tax),
      discountType: ret.discount_type,
      discountAmount: str(ret.discount_amount),
      discount: str(discountFromStored(ret.total_before_tax, ret.tax_amount, ret.final_total)),
      taxId: ret.tax_id,
      taxName: tax?.name ?? null,
      taxRate: tax ? String(tax.amount) : '0',
      taxAmount: str(ret.tax_amount),
      taxBreakdown: tax?.is_tax_group ? groupTaxBreakdown(taxSubs, ret.tax_amount) : tax ? [{ id: tax.id, name: tax.name, rate: String(tax.amount), amount: str(ret.tax_amount) }] : [],
      finalTotal: str(ret.final_total),
      amountPaid: str(paid),
      paymentDue: str(dec(ret.final_total).sub(paid)),
      createdBy: ret.created_by,
      business: { name: business?.name ?? '' },
      location: location
        ? { id: location.id, name: location.name, address: addressParts(location), mobile: location.mobile, email: location.email }
        : null,
      customer: contact
        ? {
            id: contact.id,
            name: contact.name,
            supplierBusinessName: contact.supplier_business_name,
            mobile: contact.mobile,
            address: [contact.address_line_1, contact.address_line_2, contact.city, contact.state, contact.zip_code, contact.country].filter((v): v is string => !!v && v.trim() !== '').join(', '),
          }
        : null,
      sale: parent ? { id: parent.id, invoiceNo: parent.invoice_no, transactionDate: parent.transaction_date, finalTotal: str(parent.final_total) } : null,
      lines,
      payments: payments.map((p) => ({
        id: p.id,
        amount: str(p.amount),
        method: p.method,
        paidOn: p.paid_on,
        paymentRefNo: p.payment_ref_no,
        note: p.note,
        isReturn: p.is_return,
      })),
      timeZone: user.timeZone,
    };
  }

  private async subTaxes(groupId: number) {
    const rows = await this.prisma.$queryRaw<{ id: bigint | number; name: string; amount: number | string }[]>`
      SELECT tr.id, tr.name, tr.amount FROM group_sub_taxes g JOIN tax_rates tr ON tr.id = g.tax_id WHERE g.group_tax_id = ${groupId} ORDER BY tr.id`;
    return rows.map((r) => ({ id: Number(r.id), name: r.name, amount: dec(String(r.amount)) }));
  }

  /** A sell return the user may see (location permissions; "own" users only the returns they created). */
  private async findReturn(db: TenantTx, user: AuthUser, id: number) {
    const scope = returnAccessScope(this.canFn(user));
    if (!scope) throw new ForbiddenException('You do not have permission to view sell returns');
    const ret = await db.transactions.findFirst({ where: { id, type: 'sell_return' } });
    if (!ret) throw new NotFoundException('Sell return not found');
    assertLocationPermitted(permittedLocationIds(user), ret.location_id);
    if (scope === 'own' && ret.created_by !== user.id) throw new NotFoundException('Sell return not found');
    return ret;
  }

  // ------------------------------------------------------------------------------------------------ save

  /** Create the return of a sale, or replace it when the sale already has one (Laravel `addSellReturn`). */
  async create(user: AuthUser, dto: SaveSellReturnDto) {
    if (!dto.saleId) throw new BadRequestException('saleId is required');
    return this.save(user, dto, dto.saleId);
  }

  async update(user: AuthUser, id: number, dto: SaveSellReturnDto) {
    const db = this.prisma.forTenant(user.businessId);
    const ret = await this.findReturn(db, user, id);
    if (!ret.return_parent_id) throw new BadRequestException('This return has no parent sale');
    return this.save(user, dto, ret.return_parent_id);
  }

  private async save(user: AuthUser, dto: SaveSellReturnDto, saleId: number) {
    const c = this.canFn(user);
    const scope = returnAccessScope(c);
    if (!scope) throw new ForbiddenException('You do not have permission to create sell returns');
    const db = this.prisma.forTenant(user.businessId);
    const now = new Date();

    return db.$transaction(async (tx) => {
      const bid = user.businessId;
      // The sale row is the gate: two requests returning the same sale are serialised here.
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${saleId} AND business_id = ${bid} FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id: saleId } });
      if (!sale) throw new NotFoundException('Sale not found');
      assertReturnableSale(sale);
      assertLocationPermitted(permittedLocationIds(user), sale.location_id);
      if (saleVisibilityScope(c) === 'own' && sale.created_by !== user.id) throw new NotFoundException('Sale not found');
      if (sale.location_id === null) throw new BadRequestException('The sale has no location');

      await tx.$queryRaw`SELECT id FROM transaction_sell_lines WHERE transaction_id = ${saleId} FOR UPDATE`;
      const infos = await this.lineInfos(tx, saleId);
      const existing = await tx.transactions.findFirst({ where: { type: 'sell_return', return_parent_id: saleId } });
      if (existing && scope === 'own' && existing.created_by !== user.id) throw new ForbiddenException('You can only edit the returns you created');

      // 1. quantities
      const facts: SaleLineFacts[] = infos.map((i) => ({
        id: i.line.id,
        quantity: dec(i.line.quantity),
        quantityReturned: dec(i.line.quantity_returned),
        unitPriceIncTax: dec(i.line.unit_price_inc_tax),
        multiplier: i.multiplier,
        allowDecimal: i.allowDecimal,
      }));
      const resolved = resolveReturnQuantities(facts, dto.products);
      if (!existing && !hasReturnedQuantity(resolved)) throw new BadRequestException('Enter a quantity to return for at least one item');

      // 2. totals: the tax is the tax of the parent sale (Laravel posts it as a hidden field)
      const taxRow = sale.tax_id ? await tx.tax_rates.findFirst({ where: { id: sale.tax_id, deleted_at: null } }) : null;
      const discount = normalizeDiscount(dto.discountType, dto.discountAmount);
      const totals = computeReturnTotals(
        resolved.map((r) => ({ quantity: r.newQuantity, unitPriceIncTax: r.line.unitPriceIncTax })),
        discount,
        taxRow ? String(taxRow.amount) : 0,
      );
      assertTotalsSane(totals);

      // 3. the return transaction
      const payments = existing ? await tx.transaction_payments.findMany({ where: { transaction_id: existing.id } }) : [];
      const paymentStatus = calculatePaymentStatus(totals.finalTotal, netPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return }))));
      const date = dto.transactionDate ? new Date(dto.transactionDate) : undefined;
      const typed = { discount_type: discount.type, discount_amount: discount.amount, tax_id: sale.tax_id, tax_amount: totals.tax, total_before_tax: totals.totalBeforeTax, final_total: totals.finalTotal, payment_status: paymentStatus };

      let returnId: number;
      let invoiceNo: string | null;
      if (existing) {
        invoiceNo = dto.invoiceNo?.trim() || existing.invoice_no;
        await tx.transactions.update({ where: { id: existing.id }, data: { ...typed, invoice_no: invoiceNo, ...(date ? { transaction_date: date } : {}), updated_at: now } });
        returnId = existing.id;
      } else {
        invoiceNo = dto.invoiceNo?.trim() || (await this.nextReference(tx, bid, 'sell_return'));
        const created = await tx.transactions.create({
          data: {
            business_id: bid,
            location_id: sale.location_id,
            contact_id: sale.contact_id,
            customer_group_id: sale.customer_group_id,
            type: 'sell_return',
            status: 'final',
            invoice_no: invoiceNo,
            transaction_date: date ?? now,
            created_by: user.id,
            return_parent_id: sale.id,
            essentials_duration: 0,
            created_at: now,
            updated_at: now,
            ...typed,
          },
        });
        returnId = created.id;
      }

      // 4. reward points earned on (sale total - return total)
      await this.adjustRewardPoints(tx, bid, sale, totals.finalTotal, now);

      // 5. sell lines, FIFO mapping and stock
      await this.applyLineChanges(
        tx,
        sale.location_id,
        infos,
        resolved.map((r) => ({ lineId: r.line.id, newQuantity: r.newQuantity, difference: r.difference })),
        now,
      );

      return { id: returnId, invoiceNo, finalTotal: str(totals.finalTotal), paymentStatus, saleId: sale.id };
    }, TX_OPTIONS);
  }

  /**
   * Moves the returned quantities into the sell lines, the FIFO mapping (`qty_returned`, `purchase_lines.quantity_sold`)
   * and the stock (`variation_location_details.qty_available`) in the caller's transaction.
   */
  private async applyLineChanges(
    tx: TenantTx,
    locationId: number,
    infos: readonly LineInfo[],
    changes: readonly { lineId: number; newQuantity: Dec; difference: Dec }[],
    now: Date,
  ): Promise<void> {
    const changed = changes.filter((c) => !c.difference.isZero());
    if (changed.length === 0) return;
    const infoById = new Map(infos.map((i) => [i.line.id, i]));

    const stockVariations = [...new Set(changed.map((c) => infoById.get(c.lineId)).filter((i): i is LineInfo => !!i && i.enableStock).map((i) => i.line.variation_id))];
    if (stockVariations.length > 0) {
      await tx.$queryRaw`SELECT id FROM variation_location_details WHERE location_id = ${locationId} AND variation_id IN (${Prisma.join(stockVariations)}) FOR UPDATE`;
    }

    const allMappings = await tx.transaction_sell_lines_purchase_lines.findMany({ where: { sell_line_id: { in: changed.map((c) => c.lineId) } }, orderBy: { id: 'asc' } });

    for (const change of changed) {
      const info = infoById.get(change.lineId);
      if (!info) continue;
      await tx.transaction_sell_lines.update({ where: { id: change.lineId }, data: { quantity_returned: change.newQuantity, updated_at: now } });

      // FIFO mapping
      const mappings: SellPurchaseMapping[] = allMappings
        .filter((m) => m.sell_line_id === change.lineId)
        .map((m) => ({ id: Number(m.id), purchaseLineId: m.purchase_line_id, quantity: dec(m.quantity), qtyReturned: dec(m.qty_returned) }));
      const plan = planMappingChange(mappings, change.difference);
      if (plan.updates.length > 0) {
        const purchaseIds = [...new Set(plan.updates.map((u) => u.purchaseLineId))];
        const present = new Set((await tx.purchase_lines.findMany({ where: { id: { in: purchaseIds } }, select: { id: true } })).map((p) => p.id));
        for (const u of plan.updates) {
          await tx.transaction_sell_lines_purchase_lines.update({ where: { id: BigInt(u.mappingId) }, data: { qty_returned: { increment: u.qtyReturnedDelta }, updated_at: now } });
          if (present.has(u.purchaseLineId)) {
            await tx.purchase_lines.update({ where: { id: u.purchaseLineId }, data: { quantity_sold: { increment: u.quantitySoldDelta }, updated_at: now } });
          }
        }
      }

      // stock
      const delta = stockChange(info.enableStock, change.difference);
      if (!delta.isZero()) {
        const vld = await tx.variation_location_details.findFirst({ where: { variation_id: info.line.variation_id, product_id: info.line.product_id, location_id: locationId } });
        if (vld) {
          await tx.variation_location_details.update({ where: { id: vld.id }, data: { qty_available: { increment: delta }, updated_at: now } });
        } else {
          await tx.variation_location_details.create({
            data: {
              variation_id: info.line.variation_id,
              product_id: info.line.product_id,
              product_variation_id: info.productVariationId,
              location_id: locationId,
              qty_available: delta,
              created_at: now,
              updated_at: now,
            },
          });
        }
      }
    }
  }

  private async adjustRewardPoints(tx: TenantTx, businessId: number, sale: { id: number; contact_id: number | null; final_total: Prisma.Decimal; rp_earned: number; transaction_date: Date }, returnTotal: Dec, now: Date) {
    if (!sale.rp_earned || !sale.contact_id) return;
    const b = await tx.business.findUnique({
      where: { id: businessId },
      select: { enable_rp: true, min_order_total_for_rp: true, amount_for_unit_rp: true, max_rp_per_order: true, rp_expiry_period: true, rp_expiry_type: true },
    });
    if (!b?.enable_rp) return;
    const contact = await tx.contacts.findFirst({ where: { id: sale.contact_id }, select: { id: true, is_default: true } });
    if (!contact) return;
    const adj = rewardAdjustmentForReturn({
      settings: {
        enableRp: b.enable_rp,
        minOrderTotalForRp: b.min_order_total_for_rp,
        amountForUnitRp: b.amount_for_unit_rp,
        maxRpPerOrder: b.max_rp_per_order,
        rpExpiryPeriod: b.rp_expiry_period,
        rpExpiryType: b.rp_expiry_type,
      },
      saleFinalTotal: sale.final_total,
      returnFinalTotal: returnTotal,
      saleRpEarned: sale.rp_earned,
      saleDate: sale.transaction_date,
      now,
      customerIsDefault: contact.is_default,
    });
    if (!adj) return;
    await tx.transactions.update({ where: { id: sale.id }, data: { rp_earned: adj.saleRpEarned, updated_at: now } });
    if (adj.customerDelta !== 0) await tx.contacts.update({ where: { id: contact.id }, data: { total_rp: { increment: adj.customerDelta } } });
  }

  /** Next number of a `reference_counts` counter, locked in the caller's transaction (Laravel setAndGetReferenceCount + generateReferenceNumber). */
  private async nextReference(tx: TenantTx, businessId: number, type: string): Promise<string> {
    const rows = await tx.$queryRaw<{ id: bigint | number; ref_count: number }[]>`
      SELECT id, ref_count FROM reference_counts WHERE ref_type = ${type} AND business_id = ${businessId} FOR UPDATE`;
    let count: number;
    if (rows.length > 0) {
      count = Number(rows[0].ref_count) + 1;
      await tx.$executeRaw`UPDATE reference_counts SET ref_count = ${count}, updated_at = NOW() WHERE id = ${Number(rows[0].id)}`;
    } else {
      count = 1;
      await tx.$executeRaw`INSERT INTO reference_counts (ref_type, ref_count, business_id, created_at, updated_at) VALUES (${type}, 1, ${businessId}, NOW(), NOW())`;
    }
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { ref_no_prefixes: true } });
    return formatReferenceNumber(type, count, prefixFor(business?.ref_no_prefixes, type), new Date().getFullYear());
  }

  // ------------------------------------------------------------------------------------------------ delete

  /** Laravel `destroy`: every returned quantity goes back (sell lines, FIFO mapping, stock), then the return and its payments are removed. */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await this.findReturn(db, user, id);
    const now = new Date();

    await db.$transaction(async (tx) => {
      const bid = user.businessId;
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${bid} FOR UPDATE`;
      const ret = await tx.transactions.findFirst({ where: { id, type: 'sell_return' } });
      if (!ret) throw new NotFoundException('Sell return not found');
      if (ret.return_parent_id) {
        await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${ret.return_parent_id} AND business_id = ${bid} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM transaction_sell_lines WHERE transaction_id = ${ret.return_parent_id} FOR UPDATE`;
        const infos = await this.lineInfos(tx, ret.return_parent_id, true);
        if (infos.length > 0 && ret.location_id === null) throw new BadRequestException('The return has no location');
        if (ret.location_id !== null) {
          await this.applyLineChanges(
            tx,
            ret.location_id,
            infos,
            infos.map((i) => ({ lineId: i.line.id, newQuantity: dec(0), difference: dec(i.line.quantity_returned).neg() })),
            now,
          );
        }
      }

      // Paying from the customer's advance balance took money off it; give it back (Laravel DeleteAccountTransaction).
      const payments = await tx.transaction_payments.findMany({ where: { transaction_id: id } });
      for (const p of payments) {
        if (p.method === 'advance' && p.payment_for) await tx.contacts.update({ where: { id: p.payment_for }, data: { balance: { increment: p.amount } } });
      }
      await tx.transaction_payments.deleteMany({ where: { transaction_id: id } });
      await tx.transactions.delete({ where: { id } });
    }, TX_OPTIONS);

    return { id, deleted: true };
  }

  // ------------------------------------------------------------------------------------------------ refund payments

  /** Laravel `TransactionPaymentController@store` for a `sell_return`: ref prefix `sell_payment`, status recalculated. */
  async addPayment(user: AuthUser, id: number, dto: ReturnPaymentDto) {
    const db = this.prisma.forTenant(user.businessId);
    await this.findReturn(db, user, id);
    const now = new Date();

    return db.$transaction(async (tx) => {
      const bid = user.businessId;
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${bid} FOR UPDATE`;
      const ret = await tx.transactions.findFirst({ where: { id, type: 'sell_return' } });
      if (!ret) throw new NotFoundException('Sell return not found');

      const existing = await tx.transaction_payments.findMany({ where: { transaction_id: id } });
      const paid = netPaid(existing.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
      const amount = validateRefundPayment({ amount: dto.amount, status: ret.payment_status, finalTotal: ret.final_total, totalPaid: paid });

      if (dto.method === 'advance') {
        if (!ret.contact_id) throw new BadRequestException('This return has no customer');
        await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${ret.contact_id} AND business_id = ${bid} FOR UPDATE`;
        const contact = await tx.contacts.findFirst({ where: { id: ret.contact_id }, select: { balance: true } });
        if (!contact || dec(contact.balance).lt(amount)) throw new BadRequestException('The required advance balance is not available');
        await tx.contacts.update({ where: { id: ret.contact_id }, data: { balance: { decrement: amount } } });
      }

      const refNo = await this.nextReference(tx, bid, 'sell_payment');
      const payment = await tx.transaction_payments.create({
        data: {
          transaction_id: id,
          business_id: bid,
          amount,
          method: dto.method,
          paid_on: dto.paidOn ? new Date(dto.paidOn) : now,
          created_by: user.id,
          payment_for: ret.contact_id,
          payment_ref_no: refNo,
          note: dto.note ?? null,
          card_number: dto.cardNumber ?? null,
          card_holder_name: dto.cardHolderName ?? null,
          card_transaction_number: dto.cardTransactionNumber ?? null,
          ...(dto.cardType ? { card_type: dto.cardType } : {}),
          card_month: dto.cardMonth ?? null,
          card_year: dto.cardYear ?? null,
          card_security: dto.cardSecurity ?? null,
          cheque_number: dto.chequeNumber ?? null,
          bank_account_number: dto.bankAccountNumber ?? null,
          transaction_no: dto.transactionNo ?? null,
          created_at: now,
          updated_at: now,
        },
      });

      const status = calculatePaymentStatus(ret.final_total, paid.add(amount));
      await tx.transactions.update({ where: { id }, data: { payment_status: status, updated_at: now } });
      return { id: payment.id, paymentRefNo: refNo, paymentStatus: status };
    }, TX_OPTIONS);
  }

  /** Laravel `TransactionPayment::deletePayment`: remove the payment, give back advance money, recalculate the status. */
  async removePayment(user: AuthUser, id: number, paymentId: number) {
    const db = this.prisma.forTenant(user.businessId);
    await this.findReturn(db, user, id);
    const now = new Date();

    return db.$transaction(async (tx) => {
      const bid = user.businessId;
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${bid} FOR UPDATE`;
      const ret = await tx.transactions.findFirst({ where: { id, type: 'sell_return' } });
      if (!ret) throw new NotFoundException('Sell return not found');
      const payment = await tx.transaction_payments.findFirst({ where: { id: paymentId, transaction_id: id } });
      if (!payment) throw new NotFoundException('Payment not found');

      if (payment.method === 'advance' && payment.payment_for) {
        await tx.contacts.update({ where: { id: payment.payment_for }, data: { balance: { increment: payment.amount } } });
      }
      await tx.transaction_payments.delete({ where: { id: paymentId } });
      const rest = await tx.transaction_payments.findMany({ where: { transaction_id: id } });
      const status = calculatePaymentStatus(ret.final_total, netPaid(rest.map((p) => ({ amount: p.amount, isReturn: p.is_return }))));
      await tx.transactions.update({ where: { id }, data: { payment_status: status, updated_at: now } });
      return { id: paymentId, deleted: true, paymentStatus: status };
    }, TX_OPTIONS);
  }
}
