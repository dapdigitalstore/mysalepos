import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../common/can';
import { startOfDayInstant } from '../../common/time';
import type { TenantTx } from '../../common/tenant-db';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CashRegisterService, type RegisterPaymentInput } from '../cash-register/cash-register.service';
import type { SaleDto } from './sale.dto';
import { loadBusinessCtx, stopSellingCutoffDay, type BusinessCtx } from './sale-context';
import { SaleNumberingService } from './sale-numbering.service';
import { SalePaymentsService, type EffectivePayment } from './sale-payments.service';
import { assertCreditLimit, prepareSale, type PreparedLine, type PreparedSale } from './sale-prepare';
import { SaleStockService, type MappableLine, type MappingContext } from './sale-stock.service';
import { mappingChange, stockDeltas, wantedMapping, type StockLine } from './sale-stock.rules';
import { SalesReadService } from './sales-read.service';
import { canBeEdited, dec, permittedLocations, resolveStatus, rewardPointsChange, textOrNull, ZERO } from './sale.rules';

type Dec = Prisma.Decimal;
type Header = Partial<Prisma.transactionsUncheckedCreateInput>;

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** A sell line row that exists (or was just written) with what the stock and mapping steps need to know. */
interface WrittenLine {
  id: number;
  productId: number;
  variationId: number;
  enableStock: boolean;
  quantity: Dec;
  lotNoLineId: number | null;
  label: string;
}

const toRegister = (p: EffectivePayment): RegisterPaymentInput => ({ method: p.method, amount: p.amount.toFixed(), isReturn: p.isReturn });

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: SaleStockService,
    private readonly numbering: SaleNumberingService,
    private readonly payments: SalePaymentsService,
    private readonly register: CashRegisterService,
    private readonly reader: SalesReadService,
  ) {}

  // ================================================================================================ create

  /**
   * SellPosController@store / SellController@store: POS sale, add-sale, draft, quotation, proforma and suspended sale, in one
   * database transaction (invoice number, lines, payments, stock, FIFO mapping, register rows, reward points).
   */
  async create(user: AuthUser, dto: SaleDto) {
    this.assertLocationAllowed(user, dto.locationId);
    const isDirect = !!dto.isDirectSale;
    const db = this.prisma.forTenant(user.businessId);
    const payCtx = await this.payments.context(user);

    const id = await db.$transaction(async (tx) => {
      const biz = await loadBusinessCtx(tx, user);
      await this.assertLocation(tx, dto.locationId);
      if (!isDirect) await this.assertRegisterOpen(tx, user);

      const prep = await prepareSale({ tx, user, biz, dto, isDirectSale: isDirect, existing: null, existingLines: [] });
      const st = prep.status;
      const isSuspend = !!dto.isSuspend;
      const stockLines = this.stockLinesOf(prep.lines);

      if (st.status === 'final') await this.stock.lockStock(tx, dto.locationId, stockLines.filter((l) => l.enableStock).map((l) => l.variationId));

      const custom = textOrNull(dto.invoiceNo);
      if (custom) await this.assertInvoiceNoFree(tx, custom, null);
      const invoiceNo = custom ?? (await this.numbering.nextInvoiceNumber(tx, user.businessId, biz.timeZone, biz.refNoPrefixes, st.status, dto.locationId, dto.invoiceSchemeId, isDirect));

      const now = new Date();
      const txn = await tx.transactions.create({
        data: {
          business_id: user.businessId,
          location_id: dto.locationId,
          type: 'sell',
          invoice_no: invoiceNo,
          ref_no: '',
          transaction_date: dto.transactionDate ? new Date(dto.transactionDate) : now,
          created_by: user.id,
          is_direct_sale: isDirect,
          essentials_duration: 0,
          created_at: now,
          updated_at: now,
          ...this.headerFields(biz, dto, prep, isSuspend),
          status: st.status,
        },
      });

      const written = await this.insertLines(tx, txn.id, prep.lines, now);

      // payments (never for drafts, suspended or credit sales)
      let effective: EffectivePayment[] = [];
      const takesPayments = !isSuspend && !dto.isCreditSale;
      if (takesPayments && st.status === 'final') {
        effective = await this.payments.syncSalePayments(
          tx,
          payCtx,
          { id: txn.id, type: 'sell', status: st.status, contact_id: prep.contact.id },
          dto.payments ?? [],
          this.changeOf(dto),
          false,
        );
      }

      if (st.status === 'final') {
        await this.stock.applyDeltas(tx, dto.locationId, stockDeltas('draft', [], 'final', stockLines));
        if (!isDirect && takesPayments && effective.length > 0) {
          await this.register.addSellPayments(tx, user, { id: txn.id, type: 'sell', status: 'final' }, effective.map(toRegister));
        }
        await this.payments.refreshPaymentStatus(tx, txn.id, prep.totals.finalTotal);
        await this.applyRewardPoints(tx, prep.contact.id, prep.contact.is_default, prep.rpEarned, 0, prep.rpRedeemed, 0);
        await this.reconcileMapping(tx, this.mappingContext(user, biz, dto.locationId), written, st.status, new Map());
      }
      return txn.id;
    }, TX_OPTIONS);

    return this.reader.get(user, id);
  }

  // ================================================================================================ update

  /** SellPosController@update: edit lines, header, payments and status (draft <-> final) of an existing sale. */
  async update(user: AuthUser, id: number, dto: SaleDto) {
    this.assertLocationAllowed(user, dto.locationId);
    const db = this.prisma.forTenant(user.businessId);
    const payCtx = await this.payments.context(user);

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${user.businessId} AND type = 'sell' FOR UPDATE`;
      const before = await tx.transactions.findFirst({ where: { id, type: 'sell' } });
      if (!before) throw new NotFoundException('Sale not found');
      if (before.location_id !== dto.locationId) throw new BadRequestException('The location of a sale cannot be changed');
      if ((await tx.transactions.count({ where: { return_parent_id: id } })) > 0) {
        throw new BadRequestException({ message: 'This sale has a return and cannot be edited', code: 'RETURN_EXISTS' });
      }
      const biz = await loadBusinessCtx(tx, user);
      if (!canBeEdited(before.transaction_date, biz.transactionEditDays, startOfDayInstant(biz.timeZone))) {
        throw new BadRequestException({ message: `Sales older than ${biz.transactionEditDays} days cannot be edited`, code: 'EDIT_NOT_ALLOWED' });
      }
      const isDirect = before.is_direct_sale;
      if (!isDirect) await this.assertRegisterOpen(tx, user);

      const oldLines = await tx.transaction_sell_lines.findMany({ where: { transaction_id: id }, orderBy: { id: 'asc' } });
      const manageable = oldLines.filter((l) => l.children_type !== 'modifier');
      const parents = manageable.filter((l) => !l.parent_sell_line_id);
      const prep = await prepareSale({ tx, user, biz, dto, isDirectSale: isDirect, existing: before, existingLines: parents });
      const st = prep.status;
      const isSuspend = !!dto.isSuspend;

      const productInfo = await this.productInfo(tx, manageable.map((l) => l.product_id));
      const stockBefore: StockLine[] = manageable.map((l) => ({
        productId: l.product_id,
        variationId: l.variation_id,
        quantity: l.quantity,
        enableStock: productInfo.get(l.product_id)?.enable_stock ?? false,
      }));
      const stockAfter = this.stockLinesOf(prep.lines);
      const deltas = stockDeltas(before.status, stockBefore, st.status, stockAfter);
      await this.stock.lockStock(tx, before.location_id ?? dto.locationId, [...stockBefore, ...stockAfter].filter((l) => l.enableStock).map((l) => l.variationId));

      const keptIds = new Set(prep.lines.flatMap((l) => (l.existing ? [l.existing.id] : [])));
      const removed = manageable.filter((l) => (!l.parent_sell_line_id && !keptIds.has(l.id)) || !!l.parent_sell_line_id);
      const removedIds = removed.map((l) => l.id);
      const mappedBefore = await this.stock.mappedQuantities(tx, manageable.map((l) => l.id));

      // 1. release the mapping of rows that disappear (removed lines and the old combo component rows)
      for (const l of removed) {
        const m = mappedBefore.get(l.id);
        if (m && m.gt(0)) await this.stock.release(tx, l.id, m);
      }
      // modifier rows of removed parents go with them
      const removedParentIds = new Set(removed.filter((l) => !l.parent_sell_line_id).map((l) => l.id));
      const orphanModifiers = oldLines.filter((l) => l.children_type === 'modifier' && l.parent_sell_line_id !== null && removedParentIds.has(l.parent_sell_line_id)).map((l) => l.id);
      if (removedIds.length + orphanModifiers.length > 0) await tx.transaction_sell_lines.deleteMany({ where: { id: { in: [...removedIds, ...orphanModifiers] } } });

      // 2. header
      let invoiceNo = before.invoice_no;
      const custom = textOrNull(dto.invoiceNo);
      if (custom && custom !== before.invoice_no) {
        await this.assertInvoiceNoFree(tx, custom, id);
        invoiceNo = custom;
      } else if (before.status !== st.status) {
        invoiceNo = await this.numbering.nextInvoiceNumber(tx, user.businessId, biz.timeZone, biz.refNoPrefixes, st.status, before.location_id ?? dto.locationId, before.status === 'draft' ? dto.invoiceSchemeId : null, false);
      }
      const now = new Date();
      const data: Prisma.transactionsUncheckedUpdateInput = { ...this.headerFields(biz, dto, prep, isSuspend), invoice_no: invoiceNo, status: st.status, updated_at: now };
      if (dto.transactionDate) data.transaction_date = new Date(dto.transactionDate);
      await tx.transactions.update({ where: { id }, data });

      // 3. lines: update kept ones, insert new ones and the combo component rows
      const written: WrittenLine[] = [];
      const newLines: PreparedLine[] = [];
      for (const l of prep.lines) {
        if (l.existing) {
          await tx.transaction_sell_lines.update({ where: { id: l.existing.id }, data: this.lineData(id, l, now, true) });
          written.push(this.written(l.existing.id, l));
          if (l.children.length > 0) written.push(...(await this.insertChildren(tx, id, l.existing.id, l, now)));
        } else {
          newLines.push(l);
        }
      }
      written.push(...(await this.insertLines(tx, id, newLines, now)));

      // 4. payments
      const sale = { id, type: 'sell', status: st.status, contact_id: prep.contact.id };
      let effective: EffectivePayment[] | null = null;
      const paymentsAllowed = !isSuspend && !dto.isCreditSale && (!isDirect || can(user, 'sell.payments'));
      const paymentsTouched = dto.payments !== undefined || (dto.changeReturn !== undefined && dto.changeReturn !== null) || dto.changeReturnPaymentId != null;
      if (paymentsAllowed && st.status === 'final' && paymentsTouched) {
        effective = await this.payments.syncSalePayments(tx, payCtx, sale, dto.payments ?? [], this.changeOf(dto), dto.payments !== undefined);
      }

      // 5. stock and mapping
      await this.stock.applyDeltas(tx, before.location_id ?? dto.locationId, deltas);
      await this.reconcileMapping(tx, this.mappingContext(user, biz, before.location_id ?? dto.locationId), written, st.status, mappedBefore);

      // 6. register rows
      if (!isDirect && !isSuspend && !dto.isCreditSale) {
        if (effective) {
          await this.register.updateSellPayments(tx, user, before.status, { id, type: 'sell', status: st.status }, effective.map(toRegister));
        } else if (before.status !== st.status) {
          const current = await tx.transaction_payments.findMany({ where: { transaction_id: id } });
          await this.register.updateSellPayments(
            tx,
            user,
            before.status,
            { id, type: 'sell', status: st.status },
            current.map((p) => ({ method: p.method ?? 'cash', amount: p.amount.toFixed(), isReturn: p.is_return })),
          );
        }
      }

      // 7. status, reward points
      if (st.status === 'final') await this.payments.refreshPaymentStatus(tx, id, prep.totals.finalTotal);
      else await tx.transactions.updateMany({ where: { id }, data: { payment_status: null } });
      if (before.contact_id !== prep.contact.id && before.contact_id) {
        const old = await tx.contacts.findFirst({ where: { id: before.contact_id }, select: { id: true, is_default: true } });
        if (old) await this.applyRewardPoints(tx, old.id, old.is_default, 0, before.rp_earned, 0, before.rp_redeemed);
        await this.applyRewardPoints(tx, prep.contact.id, prep.contact.is_default, prep.rpEarned, 0, prep.rpRedeemed, 0);
      } else {
        await this.applyRewardPoints(tx, prep.contact.id, prep.contact.is_default, prep.rpEarned, before.rp_earned, prep.rpRedeemed, before.rp_redeemed);
      }
    }, TX_OPTIONS);

    return this.reader.get(user, id);
  }

  // ================================================================================================ delete

  /**
   * TransactionUtil::deleteSale. Drafts are simply removed; a final sale first gives its stock back, releases the FIFO mapping,
   * reverses reward points, removes its register rows and payments (advance money returns to the customer).
   * Like Laravel the sale rows are deleted for good (transactions has no soft delete); a sale with a return cannot be deleted.
   */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${user.businessId} AND type = 'sell' FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id, type: 'sell' } });
      if (!sale) throw new NotFoundException('Sale not found');
      if ((await tx.transactions.count({ where: { return_parent_id: id } })) > 0) {
        throw new BadRequestException({ message: 'This sale has a return and cannot be deleted', code: 'RETURN_EXISTS' });
      }
      const lines = await tx.transaction_sell_lines.findMany({ where: { transaction_id: id } });

      if (sale.status !== 'draft') {
        const manageable = lines.filter((l) => l.children_type !== 'modifier');
        const productInfo = await this.productInfo(tx, manageable.map((l) => l.product_id));
        const held: StockLine[] = manageable.map((l) => ({
          productId: l.product_id,
          variationId: l.variation_id,
          quantity: l.quantity,
          enableStock: productInfo.get(l.product_id)?.enable_stock ?? false,
        }));
        const location = sale.location_id ?? 0;
        await this.stock.lockStock(tx, location, held.filter((h) => h.enableStock).map((h) => h.variationId));
        await this.stock.applyDeltas(tx, location, stockDeltas('final', held, 'draft', []));

        const mapped = await this.stock.mappedQuantities(tx, manageable.map((l) => l.id));
        for (const l of manageable) {
          const m = mapped.get(l.id);
          if (m && m.gt(0)) await this.stock.release(tx, l.id, m);
        }
        if (sale.contact_id) {
          const contact = await tx.contacts.findFirst({ where: { id: sale.contact_id }, select: { id: true, is_default: true } });
          if (contact) await this.applyRewardPoints(tx, contact.id, contact.is_default, 0, sale.rp_earned, 0, sale.rp_redeemed);
        }
        await tx.cash_register_transactions.deleteMany({ where: { transaction_id: id } });
        const payments = await tx.transaction_payments.findMany({ where: { transaction_id: id } });
        for (const p of payments) await this.payments.deleteLine(tx, p, false);
      }
      await tx.transaction_sell_lines.deleteMany({ where: { transaction_id: id } });
      await tx.transactions.delete({ where: { id } });
    }, TX_OPTIONS);
    return { success: true };
  }

  // ================================================================================================ convert / duplicate

  /** SellPosController@convertToInvoice: a draft or quotation becomes a final invoice with a fresh invoice number, dated now. */
  async convertToInvoice(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${id} AND business_id = ${user.businessId} AND type = 'sell' FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id, type: 'sell', status: 'draft' } });
      if (!sale) throw new NotFoundException('Draft or quotation not found');
      this.assertLocationAllowed(user, sale.location_id ?? 0);
      const biz = await loadBusinessCtx(tx, user);
      const contact = sale.contact_id ? await tx.contacts.findFirst({ where: { id: sale.contact_id }, select: { id: true, credit_limit: true, is_default: true } }) : null;
      if (contact) await assertCreditLimit(tx, user.businessId, contact, sale.final_total, ZERO, id, biz.currencyPrecision);
      if (!sale.is_direct_sale) await this.assertRegisterOpen(tx, user);

      const lines = (await tx.transaction_sell_lines.findMany({ where: { transaction_id: id }, orderBy: { id: 'asc' } })).filter((l) => l.children_type !== 'modifier');
      const productInfo = await this.productInfo(tx, lines.map((l) => l.product_id));
      const location = sale.location_id ?? 0;
      const stockLines: StockLine[] = lines.map((l) => ({ productId: l.product_id, variationId: l.variation_id, quantity: l.quantity, enableStock: productInfo.get(l.product_id)?.enable_stock ?? false }));
      await this.stock.lockStock(tx, location, stockLines.filter((l) => l.enableStock).map((l) => l.variationId));

      const invoiceNo = await this.numbering.nextInvoiceNumber(tx, user.businessId, biz.timeZone, biz.refNoPrefixes, 'final', location, null, false);
      const now = new Date();
      await tx.transactions.update({
        where: { id },
        data: { invoice_no: invoiceNo, transaction_date: now, status: 'final', sub_status: null, is_quotation: false, updated_at: now },
      });
      await this.stock.applyDeltas(tx, location, stockDeltas('draft', [], 'final', stockLines));
      await this.payments.refreshPaymentStatus(tx, id, sale.final_total);
      const written: WrittenLine[] = lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        variationId: l.variation_id,
        enableStock: productInfo.get(l.product_id)?.enable_stock ?? false,
        quantity: l.quantity,
        lotNoLineId: l.lot_no_line_id,
        label: productInfo.get(l.product_id)?.name ?? `Product ${l.product_id}`,
      }));
      await this.reconcileMapping(tx, this.mappingContext(user, biz, location), written, 'final', new Map());
    }, TX_OPTIONS);
    return this.reader.get(user, id);
  }

  /** SellPosController@convertToProforma: a draft or quotation gets the proforma sub status. */
  async convertToProforma(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const sale = await db.transactions.findFirst({ where: { id, type: 'sell', status: 'draft' }, select: { id: true, location_id: true } });
    if (!sale) throw new NotFoundException('Draft or quotation not found');
    this.assertLocationAllowed(user, sale.location_id ?? 0);
    await db.transactions.updateMany({ where: { id }, data: { sub_status: 'proforma', is_quotation: false, updated_at: new Date() } });
    return this.reader.get(user, id);
  }

  /** SellController@duplicateSell / SellPosController@copyQuotation: copies the header and lines into a new draft (payments are not copied, stock is untouched). */
  async duplicate(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const newId = await db.$transaction(async (tx) => {
      const src = await tx.transactions.findFirst({ where: { id, type: 'sell' } });
      if (!src) throw new NotFoundException('Sale not found');
      this.assertLocationAllowed(user, src.location_id ?? 0);
      const biz = await loadBusinessCtx(tx, user);
      const invoiceNo = await this.numbering.nextInvoiceNumber(tx, user.businessId, biz.timeZone, biz.refNoPrefixes, 'draft', src.location_id ?? 0, null, false);
      const now = new Date();
      const { id: _id, created_at: _c, updated_at: _u, ...copy } = src;
      const created = await tx.transactions.create({
        data: {
          ...copy,
          status: 'draft',
          payment_status: null,
          transaction_date: now,
          created_by: user.id,
          invoice_token: null,
          invoice_no: invoiceNo,
          is_suspend: false,
          rp_earned: 0,
          rp_redeemed: 0,
          rp_redeemed_amount: ZERO,
          created_at: now,
          updated_at: now,
        },
      });
      const lines = await tx.transaction_sell_lines.findMany({ where: { transaction_id: id }, orderBy: { id: 'asc' } });
      const idMap = new Map<number, number>();
      for (const l of lines.filter((x) => !x.parent_sell_line_id)) idMap.set(l.id, await this.copyLine(tx, l, created.id, null, now));
      for (const l of lines.filter((x) => x.parent_sell_line_id)) {
        const parent = idMap.get(l.parent_sell_line_id ?? 0);
        if (parent) idMap.set(l.id, await this.copyLine(tx, l, created.id, parent, now));
      }
      return created.id;
    }, TX_OPTIONS);
    return this.reader.get(user, newId);
  }

  private async copyLine(tx: TenantTx, l: Prisma.transaction_sell_linesGetPayload<object>, transactionId: number, parentId: number | null, now: Date): Promise<number> {
    const { id: _id, transaction_id: _t, created_at: _c, updated_at: _u, lot_no_line_id: _l, parent_sell_line_id: _p, so_line_id: _s, ...rest } = l;
    const row = await tx.transaction_sell_lines.create({
      data: { ...rest, transaction_id: transactionId, parent_sell_line_id: parentId, quantity_returned: ZERO, so_line_id: null, created_at: now, updated_at: now },
    });
    return row.id;
  }

  // ================================================================================================ small helpers

  /** GET /sales/check-invoice-no */
  async invoiceNoAvailable(user: AuthUser, invoiceNo: string, excludeId?: number) {
    const db = this.prisma.forTenant(user.businessId);
    const row = await db.transactions.findFirst({ where: { invoice_no: invoiceNo, type: 'sell', ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    return { available: !row };
  }

  private assertLocationAllowed(user: AuthUser, locationId: number): void {
    const permitted = permittedLocations(user);
    if (permitted !== null && !permitted.includes(locationId)) throw new ForbiddenException('You cannot sell from this location');
  }

  private async assertLocation(tx: TenantTx, locationId: number): Promise<void> {
    const location = await tx.business_locations.findFirst({ where: { id: locationId, deleted_at: null, is_active: true }, select: { id: true } });
    if (!location) throw new BadRequestException('Business location not found');
  }

  private async assertRegisterOpen(tx: TenantTx, user: AuthUser): Promise<void> {
    const reg = await this.register.getOpenRegister(tx, user);
    if (!reg) throw new BadRequestException({ message: 'Open a cash register before selling', code: 'REGISTER_NOT_OPEN' });
  }

  private async assertInvoiceNoFree(tx: TenantTx, invoiceNo: string, excludeId: number | null): Promise<void> {
    const row = await tx.transactions.findFirst({ where: { invoice_no: invoiceNo, type: 'sell', ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (row) throw new ConflictException({ message: `Invoice number ${invoiceNo} is already used`, code: 'INVOICE_NO_TAKEN' });
  }

  private changeOf(dto: SaleDto) {
    return {
      amount: dec(dto.changeReturn),
      method: dto.changeReturnMethod ?? 'cash',
      accountId: dto.changeReturnAccountId ?? null,
      paymentId: dto.changeReturnPaymentId ?? null,
    };
  }

  private mappingContext(user: AuthUser, biz: BusinessCtx, locationId: number): MappingContext {
    return { businessId: user.businessId, locationId, accountingMethod: biz.accountingMethod, allowOverselling: biz.allowOverselling, stopSellingCutoff: stopSellingCutoffDay(biz) };
  }

  private async productInfo(tx: TenantTx, productIds: number[]) {
    const ids = [...new Set(productIds)];
    const rows = ids.length ? await tx.products.findMany({ where: { id: { in: ids } }, select: { id: true, enable_stock: true, name: true } }) : [];
    return new Map(rows.map((p) => [p.id, p]));
  }

  /** Parents and combo components as stock lines (quantities in base units). */
  private stockLinesOf(lines: PreparedLine[]): StockLine[] {
    const out: StockLine[] = [];
    for (const l of lines) {
      out.push({ productId: l.variation.product_id, variationId: l.variation.id, quantity: l.calc.stored.quantity, enableStock: l.enableStock });
      for (const c of l.children) out.push({ productId: c.productId, variationId: c.variationId, quantity: c.quantity, enableStock: c.enableStock });
    }
    return out;
  }

  private written(id: number, l: PreparedLine): WrittenLine {
    return { id, productId: l.variation.product_id, variationId: l.variation.id, enableStock: l.enableStock, quantity: l.calc.stored.quantity, lotNoLineId: l.dto.lotNoLineId ?? null, label: l.label };
  }

  private lineData(transactionId: number, l: PreparedLine, now: Date, isUpdate = false) {
    const s = l.calc.stored;
    const base = {
      product_id: l.variation.product_id,
      variation_id: l.variation.id,
      quantity: s.quantity,
      unit_price_before_discount: s.unit_price_before_discount,
      unit_price: s.unit_price,
      line_discount_type: s.line_discount_type,
      line_discount_amount: s.line_discount_amount,
      item_tax: s.item_tax,
      tax_id: l.taxId,
      unit_price_inc_tax: s.unit_price_inc_tax,
      sell_line_note: textOrNull(l.dto.sellLineNote) ?? '',
      sub_unit_id: l.dto.subUnitId && l.dto.subUnitId !== l.variation.products.unit_id ? l.dto.subUnitId : null,
      res_service_staff_id: l.dto.resServiceStaffId ?? null,
      secondary_unit_quantity: dec(l.dto.secondaryUnitQuantity),
      updated_at: now,
    };
    if (isUpdate) return base;
    return {
      ...base,
      transaction_id: transactionId,
      discount_id: null,
      lot_no_line_id: l.dto.lotNoLineId ?? null,
      res_line_order_status: l.dto.resServiceStaffId ? 'received' : null,
      created_at: now,
    };
  }

  private async insertLines(tx: TenantTx, transactionId: number, lines: PreparedLine[], now: Date): Promise<WrittenLine[]> {
    const out: WrittenLine[] = [];
    for (const l of lines) {
      const row = await tx.transaction_sell_lines.create({ data: this.lineData(transactionId, l, now) as Prisma.transaction_sell_linesUncheckedCreateInput });
      out.push(this.written(row.id, l));
      out.push(...(await this.insertChildren(tx, transactionId, row.id, l, now)));
    }
    return out;
  }

  private async insertChildren(tx: TenantTx, transactionId: number, parentId: number, l: PreparedLine, now: Date): Promise<WrittenLine[]> {
    const out: WrittenLine[] = [];
    for (const c of l.children) {
      const row = await tx.transaction_sell_lines.create({
        data: {
          transaction_id: transactionId,
          product_id: c.productId,
          variation_id: c.variationId,
          quantity: c.quantity,
          unit_price_before_discount: c.unitPrice,
          unit_price: c.unitPrice,
          line_discount_type: null,
          line_discount_amount: ZERO,
          item_tax: ZERO,
          tax_id: null,
          unit_price_inc_tax: c.unitPrice,
          sub_unit_id: null,
          discount_id: null,
          parent_sell_line_id: parentId,
          children_type: 'combo',
          created_at: now,
          updated_at: now,
        },
      });
      out.push({ id: row.id, productId: c.productId, variationId: c.variationId, enableStock: c.enableStock, quantity: c.quantity, lotNoLineId: null, label: c.label });
    }
    return out;
  }

  /** Brings the FIFO mapping of every written line to what the new status needs (releases first, then allocates). */
  private async reconcileMapping(tx: TenantTx, ctx: MappingContext, lines: WrittenLine[], status: string, current: Map<number, Dec>): Promise<void> {
    const plan = lines.map((l) => ({ line: l as MappableLine, wanted: wantedMapping(status, l.enableStock, l.quantity), current: current.get(l.id) ?? ZERO }));
    for (const p of plan) if (mappingChange(p.wanted, p.current).kind === 'release') await this.stock.reconcile(tx, ctx, p.line, p.wanted, p.current);
    for (const p of plan) if (mappingChange(p.wanted, p.current).kind === 'allocate') await this.stock.reconcile(tx, ctx, p.line, p.wanted, p.current);
  }

  /** `updateCustomerRewardPoints`: walk-in customers never collect points. */
  private async applyRewardPoints(tx: TenantTx, contactId: number, isDefault: boolean, earned: number, earnedBefore: number, redeemed: number, redeemedBefore: number): Promise<void> {
    if (isDefault) return;
    const change = rewardPointsChange(earned, earnedBefore, redeemed, redeemedBefore);
    if (change.totalRpDelta === 0 && change.usedDelta === 0) return;
    await tx.contacts.update({
      where: { id: contactId },
      data: { total_rp: { increment: change.totalRpDelta }, total_rp_used: { increment: change.usedDelta }, updated_at: new Date() },
    });
  }

  /** The header columns shared by create and update (createSellTransaction / updateSellTransaction). */
  private headerFields(biz: BusinessCtx, dto: SaleDto, prep: PreparedSale, isSuspend: boolean): Header {
    const st = resolveStatus(dto.status);
    const t = prep.totals;
    const add = (i: number) => prep.additional[i];
    const custom = (i: number) => textOrNull(dto.customFields?.[i]);
    const shipCustom = (i: number) => textOrNull(dto.shippingCustomFields?.[i]);
    const servicesOn = biz.modules.includes('types_of_service');
    const tablesOn = biz.modules.includes('tables');
    const staffOn = biz.modules.includes('service_staff');
    const kitchenOn = biz.modules.includes('kitchen');
    return {
      location_id: dto.locationId,
      sub_status: st.subStatus,
      is_quotation: st.isQuotation,
      contact_id: prep.contact.id,
      customer_group_id: prep.customerGroupId,
      total_before_tax: t.totalBeforeTax,
      tax_id: prep.orderTaxId,
      discount_type: dto.discountType ?? null,
      discount_amount: dec(dto.discountAmount),
      tax_amount: t.taxAmount,
      final_total: t.finalTotal,
      additional_notes: textOrNull(dto.saleNote),
      staff_note: textOrNull(dto.staffNote),
      custom_field_1: custom(0),
      custom_field_2: custom(1),
      custom_field_3: custom(2),
      custom_field_4: custom(3),
      commission_agent: prep.commissionAgent,
      shipping_details: textOrNull(dto.shippingDetails),
      shipping_address: textOrNull(dto.shippingAddress),
      shipping_status: textOrNull(dto.shippingStatus),
      delivered_to: textOrNull(dto.deliveredTo),
      delivery_person: dto.deliveryPerson ? BigInt(dto.deliveryPerson) : null,
      shipping_charges: dec(dto.shippingCharges),
      shipping_custom_field_1: shipCustom(0),
      shipping_custom_field_2: shipCustom(1),
      shipping_custom_field_3: shipCustom(2),
      shipping_custom_field_4: shipCustom(3),
      shipping_custom_field_5: shipCustom(4),
      exchange_rate: prep.exchangeRate,
      selling_price_group_id: dto.sellingPriceGroupId ?? null,
      pay_term_number: prep.payTermNumber,
      pay_term_type: prep.payTermType,
      is_suspend: isSuspend,
      rp_earned: prep.rpEarned,
      rp_redeemed: prep.rpRedeemed,
      rp_redeemed_amount: prep.rpRedeemedAmount,
      types_of_service_id: servicesOn ? prep.typesOfServiceId : null,
      packing_charge: servicesOn ? prep.packingCharge : ZERO,
      packing_charge_type: servicesOn ? prep.packingChargeType : null,
      round_off_amount: t.roundOffAmount,
      additional_expense_key_1: add(0)?.key ?? null,
      additional_expense_value_1: add(0)?.value ?? ZERO,
      additional_expense_key_2: add(1)?.key ?? null,
      additional_expense_value_2: add(1)?.value ?? ZERO,
      additional_expense_key_3: add(2)?.key ?? null,
      additional_expense_value_3: add(2)?.value ?? ZERO,
      additional_expense_key_4: add(3)?.key ?? null,
      additional_expense_value_4: add(3)?.value ?? ZERO,
      res_table_id: tablesOn ? dto.resTableId ?? null : null,
      res_waiter_id: staffOn ? dto.resWaiterId ?? null : null,
      is_kitchen_order: kitchenOn ? !!dto.isKitchenOrder : false,
    };
  }
}
