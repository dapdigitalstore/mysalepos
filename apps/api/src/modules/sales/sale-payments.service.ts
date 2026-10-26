import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantTx } from '../../common/tenant-db';
import type { PaymentDto, SalePaymentDto } from './sale.dto';
import { SaleNumberingService } from './sale-numbering.service';
import {
  accountTransactionType,
  assertPayable,
  CUSTOM_PAY_METHOD,
  dec,
  isKnownPaymentMethod,
  normalizePaymentRows,
  paymentStatus,
  textOrNull,
  totalPaid,
  ZERO,
  type PaymentStatus,
} from './sale.rules';

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** What the payment code needs to know about the business, loaded once per request. */
export interface PaymentContext {
  businessId: number;
  userId: number;
  timeZone: string;
  refNoPrefixes: string | null;
  accountModuleEnabled: boolean;
}

export interface SaleRef {
  id: number;
  type: string | null;
  status: string;
  contact_id: number | null;
}

/** One payment line after validation, as the cash register and the status maths see it. */
export interface EffectivePayment {
  id: number;
  method: string;
  amount: Prisma.Decimal;
  isReturn: boolean;
}

/** A payment row plus whether it is the change given back (is_return). */
interface PaymentRow extends SalePaymentDto {
  isReturn?: boolean;
}

@Injectable()
export class SalePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: SaleNumberingService,
  ) {}

  // ---------------------------------------------------------------- building blocks (used inside a sale transaction)

  /**
   * `createOrUpdatePaymentLines` for a sale: edits rows that carry an `id`, creates the others and (when `replace`) deletes the
   * existing payments that were not listed. Draft sales never hold payments. Returns the payments that now count for the sale
   * (what the cash register is told about).
   */
  async syncSalePayments(
    tx: TenantTx,
    ctx: PaymentContext,
    sale: SaleRef,
    rows: SalePaymentDto[],
    change: { amount: Prisma.Decimal; method: string; accountId: number | null; paymentId: number | null },
    replace: boolean,
  ): Promise<EffectivePayment[]> {
    if (sale.status === 'draft') return [];
    const all: PaymentRow[] = rows.map((r) => ({ ...r }));
    if (change.paymentId !== null || !change.amount.isZero()) {
      all.push({ id: change.paymentId ?? undefined, method: change.method, amount: change.amount.toFixed(), isReturn: true, accountId: change.accountId });
    }
    for (const r of all) if (!isKnownPaymentMethod(r.method)) throw new BadRequestException(`Unknown payment method "${r.method}"`);

    const contact = sale.contact_id ? await tx.contacts.findFirst({ where: { id: sale.contact_id }, select: { balance: true } }) : null;
    const normalized = normalizePaymentRows(all, contact?.balance ?? ZERO);

    const existing = await tx.transaction_payments.findMany({ where: { transaction_id: sale.id } });
    const existingById = new Map(existing.map((p) => [p.id, p]));
    const keptIds = new Set<number>();
    const effective: EffectivePayment[] = [];

    for (const r of normalized) {
      if (r.id !== undefined) {
        const current = existingById.get(r.id);
        if (!current) throw new BadRequestException(`Payment ${r.id} does not belong to this sale`);
        keptIds.add(r.id);
        const updated = await this.editLine(tx, ctx, sale, current, r);
        effective.push({ id: updated.id, method: updated.method ?? r.method, amount: dec(updated.amount), isReturn: updated.is_return });
      } else {
        const created = await this.addLine(tx, ctx, sale, r, !!r.isReturn);
        effective.push({ id: created.id, method: r.method, amount: dec(created.amount), isReturn: !!r.isReturn });
      }
    }

    if (replace) {
      for (const p of existing) if (!keptIds.has(p.id)) await this.deleteLine(tx, p, false);
    } else {
      for (const p of existing) if (!keptIds.has(p.id)) effective.push({ id: p.id, method: p.method ?? 'cash', amount: dec(p.amount), isReturn: p.is_return });
    }
    return effective;
  }

  /** Creates one payment row (+ advance balance and account transaction side effects). */
  async addLine(tx: TenantTx, ctx: PaymentContext, sale: SaleRef, p: PaymentRow, isReturn: boolean) {
    const amount = dec(p.amount);
    const now = new Date();
    const refNo = await this.numbering.nextReferenceNumber(tx, ctx.businessId, ctx.timeZone, ctx.refNoPrefixes, 'sell_payment');
    if (p.accountId) await this.assertAccount(tx, p.accountId);
    const accountId = p.accountId && p.method !== 'advance' ? p.accountId : null;
    const paidOn = p.paidOn ? new Date(p.paidOn) : now;
    const payment = await tx.transaction_payments.create({
      data: {
        transaction_id: sale.id,
        business_id: ctx.businessId,
        is_return: isReturn,
        amount,
        method: p.method,
        card_transaction_number: textOrNull(p.cardTransactionNumber),
        card_number: textOrNull(p.cardNumber),
        card_type: textOrNull(p.cardType),
        card_holder_name: textOrNull(p.cardHolderName),
        card_month: textOrNull(p.cardMonth),
        card_year: textOrNull(p.cardYear),
        card_security: textOrNull(p.cardSecurity),
        cheque_number: textOrNull(p.chequeNumber),
        bank_account_number: textOrNull(p.bankAccountNumber),
        transaction_no: CUSTOM_PAY_METHOD.test(p.method) ? textOrNull(p.transactionNo) : null,
        note: textOrNull(p.note),
        paid_on: paidOn,
        created_by: ctx.userId,
        payment_for: sale.contact_id,
        payment_ref_no: refNo,
        account_id: accountId,
        created_at: now,
        updated_at: now,
      },
    });
    // TransactionPaymentAdded listeners: paying from the advance balance spends it; an account gets a ledger row.
    if (p.method === 'advance' && sale.contact_id) {
      await tx.contacts.update({ where: { id: sale.contact_id }, data: { balance: { decrement: amount }, updated_at: now } });
    }
    if (ctx.accountModuleEnabled && accountId) {
      await tx.account_transactions.create({
        data: {
          amount,
          account_id: accountId,
          type: accountTransactionType(isReturn),
          operation_date: paidOn,
          created_by: ctx.userId,
          transaction_id: sale.id,
          transaction_payment_id: payment.id,
          created_at: now,
          updated_at: now,
        },
      });
    }
    return payment;
  }

  /** `editPaymentLine` (+ the account transaction that follows the payment). Advance payments cannot be edited. */
  async editLine(tx: TenantTx, ctx: PaymentContext, sale: SaleRef, current: { id: number; method: string | null; is_return: boolean }, p: PaymentRow) {
    if (current.method === 'advance' || p.method === 'advance') {
      throw new BadRequestException({ message: 'An advance payment cannot be edited. Delete it and add a new payment.', code: 'ADVANCE_PAYMENT_LOCKED' });
    }
    if (p.accountId) await this.assertAccount(tx, p.accountId);
    const now = new Date();
    // Fields that are omitted stay as stored; null (or an empty string) clears them.
    const data: Prisma.transaction_paymentsUncheckedUpdateInput = { amount: dec(p.amount), method: p.method, updated_at: now };
    if (p.cardTransactionNumber !== undefined) data.card_transaction_number = textOrNull(p.cardTransactionNumber);
    if (p.cardNumber !== undefined) data.card_number = textOrNull(p.cardNumber);
    if (p.cardType !== undefined) data.card_type = textOrNull(p.cardType);
    if (p.cardHolderName !== undefined) data.card_holder_name = textOrNull(p.cardHolderName);
    if (p.cardMonth !== undefined) data.card_month = textOrNull(p.cardMonth);
    if (p.cardYear !== undefined) data.card_year = textOrNull(p.cardYear);
    if (p.cardSecurity !== undefined) data.card_security = textOrNull(p.cardSecurity);
    if (p.chequeNumber !== undefined) data.cheque_number = textOrNull(p.chequeNumber);
    if (p.bankAccountNumber !== undefined) data.bank_account_number = textOrNull(p.bankAccountNumber);
    if (p.note !== undefined) data.note = textOrNull(p.note);
    if (!CUSTOM_PAY_METHOD.test(p.method)) data.transaction_no = null;
    else if (p.transactionNo !== undefined) data.transaction_no = textOrNull(p.transactionNo);
    if (p.accountId !== undefined) data.account_id = p.accountId;
    if (p.paidOn) data.paid_on = new Date(p.paidOn);
    const updated = await tx.transaction_payments.update({ where: { id: current.id }, data });
    await this.syncAccountTransaction(tx, ctx, sale, updated);
    return updated;
  }

  /** TransactionPaymentUpdated listener: keep the account ledger row in line with the payment. */
  private async syncAccountTransaction(
    tx: TenantTx,
    ctx: PaymentContext,
    sale: SaleRef,
    payment: { id: number; amount: Prisma.Decimal; account_id: number | null; paid_on: Date | null; is_return: boolean; created_by: number | null },
  ) {
    if (!ctx.accountModuleEnabled || !payment.account_id) return;
    const now = new Date();
    const row = await tx.account_transactions.findFirst({ where: { transaction_payment_id: payment.id, deleted_at: null } });
    if (row) {
      await tx.account_transactions.update({
        where: { id: row.id },
        data: { amount: payment.amount, account_id: payment.account_id, operation_date: payment.paid_on ?? now, updated_at: now },
      });
    } else {
      await tx.account_transactions.create({
        data: {
          amount: payment.amount,
          account_id: payment.account_id,
          type: accountTransactionType(payment.is_return),
          operation_date: payment.paid_on ?? now,
          created_by: payment.created_by ?? ctx.userId,
          transaction_id: sale.id,
          transaction_payment_id: payment.id,
          created_at: now,
          updated_at: now,
        },
      });
    }
  }

  /**
   * `TransactionPayment::deletePayment` + DeleteAccountTransaction: removes the row, takes it off a parent payment,
   * returns advance money to the customer and soft-deletes the account ledger row.
   */
  async deleteLine(
    tx: TenantTx,
    payment: { id: number; method: string | null; amount: Prisma.Decimal; payment_for: number | null; parent_id: number | null },
    fixParent = true,
  ): Promise<void> {
    const now = new Date();
    if (fixParent && payment.parent_id) {
      const parent = await tx.transaction_payments.findFirst({ where: { id: payment.parent_id } });
      if (parent) {
        const left = parent.amount.sub(payment.amount);
        if (left.lte(0)) await tx.transaction_payments.delete({ where: { id: parent.id } });
        else await tx.transaction_payments.update({ where: { id: parent.id }, data: { amount: left, updated_at: now } });
      }
    }
    await tx.transaction_payments.delete({ where: { id: payment.id } });
    if (payment.method === 'advance' && payment.payment_for) {
      await tx.contacts.update({ where: { id: payment.payment_for }, data: { balance: { increment: payment.amount }, updated_at: now } });
    }
    await tx.account_transactions.updateMany({ where: { transaction_payment_id: payment.id, deleted_at: null }, data: { deleted_at: now, updated_at: now } });
  }

  /** `updatePaymentStatus`: recalculates paid / partial / due from the payments and stores it. */
  async refreshPaymentStatus(tx: TenantTx, saleId: number, finalTotal?: Prisma.Decimal): Promise<PaymentStatus> {
    const payments = await tx.transaction_payments.findMany({ where: { transaction_id: saleId }, select: { amount: true, is_return: true } });
    const paid = totalPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
    let total = finalTotal;
    if (!total) {
      const sale = await tx.transactions.findFirst({ where: { id: saleId }, select: { final_total: true } });
      total = sale?.final_total ?? ZERO;
    }
    const status = paymentStatus(total, paid);
    await tx.transactions.updateMany({ where: { id: saleId }, data: { payment_status: status, updated_at: new Date() } });
    return status;
  }

  private async assertAccount(tx: TenantTx, accountId: number): Promise<void> {
    const account = await tx.accounts.findFirst({ where: { id: accountId, deleted_at: null }, select: { id: true } });
    if (!account) throw new BadRequestException('Payment account not found');
  }

  // ---------------------------------------------------------------- endpoints

  /** Context for payment writes, read from the business row. */
  async context(user: AuthUser): Promise<PaymentContext> {
    const b = await this.prisma.business.findUnique({ where: { id: user.businessId }, select: { ref_no_prefixes: true, enabled_modules: true, time_zone: true } });
    if (!b) throw new NotFoundException('Business not found');
    let modules: string[] = [];
    try {
      const parsed: unknown = b.enabled_modules ? JSON.parse(b.enabled_modules) : [];
      modules = Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
    } catch {
      modules = [];
    }
    return { businessId: user.businessId, userId: user.id, timeZone: user.timeZone || b.time_zone, refNoPrefixes: b.ref_no_prefixes, accountModuleEnabled: modules.includes('account') };
  }

  /** GET /sales/:id/payments */
  async listForSale(user: AuthUser, saleId: number) {
    const db = this.prisma.forTenant(user.businessId);
    const sale = await db.transactions.findFirst({ where: { id: saleId, type: 'sell' }, select: { id: true, final_total: true, payment_status: true, contact_id: true, location_id: true } });
    if (!sale) throw new NotFoundException('Sale not found');
    const payments = await db.transaction_payments.findMany({ where: { transaction_id: saleId }, orderBy: { id: 'asc' } });
    const paid = totalPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
    return {
      saleId: sale.id,
      finalTotal: sale.final_total.toFixed(),
      totalPaid: paid.toFixed(),
      due: sale.final_total.sub(paid).toFixed(),
      paymentStatus: sale.payment_status,
      payments: payments.map((p) => this.present(p)),
    };
  }

  /** GET /sale-payments/:id */
  async get(user: AuthUser, paymentId: number) {
    const db = this.prisma.forTenant(user.businessId);
    const p = await db.transaction_payments.findFirst({ where: { id: paymentId } });
    if (!p || !p.transaction_id) throw new NotFoundException('Payment not found');
    const sale = await db.transactions.findFirst({ where: { id: p.transaction_id, type: 'sell' }, select: { id: true, invoice_no: true, final_total: true } });
    if (!sale) throw new NotFoundException('Payment not found');
    return { ...this.present(p), sale: { id: sale.id, invoiceNo: sale.invoice_no, finalTotal: sale.final_total.toFixed() } };
  }

  /** What the "add payment" dialog needs: the due amount and the default values (Laravel addPayment()). */
  async defaults(user: AuthUser, saleId: number) {
    const db = this.prisma.forTenant(user.businessId);
    const sale = await db.transactions.findFirst({ where: { id: saleId, type: 'sell' }, select: { id: true, final_total: true, payment_status: true, status: true, invoice_no: true } });
    if (!sale) throw new NotFoundException('Sale not found');
    const payments = await db.transaction_payments.findMany({ where: { transaction_id: saleId }, select: { amount: true, is_return: true } });
    const paid = totalPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
    const due = Prisma.Decimal.max(ZERO, sale.final_total.sub(paid));
    return {
      saleId: sale.id,
      invoiceNo: sale.invoice_no,
      status: sale.payment_status === 'paid' || sale.status !== 'final' ? 'closed' : 'due',
      finalTotal: sale.final_total.toFixed(),
      totalPaid: paid.toFixed(),
      amount: due.toFixed(),
      method: 'cash',
      paidOn: new Date().toISOString(),
    };
  }

  /** POST /sales/:id/payments  (TransactionPaymentController@store) */
  async add(user: AuthUser, saleId: number, dto: PaymentDto) {
    if (!isKnownPaymentMethod(dto.method)) throw new BadRequestException(`Unknown payment method "${dto.method}"`);
    const ctx = await this.context(user);
    const db = this.prisma.forTenant(user.businessId);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${saleId} AND business_id = ${user.businessId} FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id: saleId, type: 'sell' } });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status !== 'final') throw new BadRequestException('Payments can only be added to a final sale');
      const amount = dec(dto.amount);
      if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than 0');
      const payments = await tx.transaction_payments.findMany({ where: { transaction_id: saleId }, select: { amount: true, is_return: true } });
      assertPayable(sale.final_total, totalPaid(payments.map((p) => ({ amount: p.amount, isReturn: p.is_return }))), amount);
      if (dto.method === 'advance') {
        const contact = sale.contact_id ? await tx.contacts.findFirst({ where: { id: sale.contact_id }, select: { balance: true } }) : null;
        if (amount.gt(contact?.balance ?? ZERO)) {
          throw new BadRequestException({ message: 'The required advance balance is not available', code: 'ADVANCE_BALANCE_NOT_AVAILABLE' });
        }
      }
      await this.addLine(tx, ctx, { id: sale.id, type: sale.type, status: sale.status, contact_id: sale.contact_id }, { ...dto, amount: amount.toFixed() }, false);
      await this.refreshPaymentStatus(tx, saleId, sale.final_total);
    }, TX_OPTIONS);
    return this.listForSale(user, saleId);
  }

  /** PUT /sale-payments/:id  (TransactionPaymentController@update; advance payments are not editable) */
  async update(user: AuthUser, paymentId: number, dto: PaymentDto) {
    if (!isKnownPaymentMethod(dto.method)) throw new BadRequestException(`Unknown payment method "${dto.method}"`);
    const ctx = await this.context(user);
    const db = this.prisma.forTenant(user.businessId);
    const saleId = await db.$transaction(async (tx) => {
      const payment = await tx.transaction_payments.findFirst({ where: { id: paymentId } });
      if (!payment || !payment.transaction_id) throw new NotFoundException('Payment not found');
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${payment.transaction_id} AND business_id = ${user.businessId} FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id: payment.transaction_id, type: 'sell' } });
      if (!sale) throw new NotFoundException('Payment not found');
      const amount = dec(dto.amount);
      if (amount.lt(0)) throw new BadRequestException('Payment amount cannot be negative');
      // The new amount may not push the paid total above the invoice total (change given back excluded).
      const others = await tx.transaction_payments.findMany({ where: { transaction_id: sale.id, id: { not: payment.id } }, select: { amount: true, is_return: true } });
      const paidWithout = totalPaid(others.map((p) => ({ amount: p.amount, isReturn: p.is_return })));
      if (!payment.is_return && paidWithout.add(amount).gt(sale.final_total) && amount.gt(payment.amount)) {
        throw new BadRequestException({ message: 'The payment cannot be more than the due amount', code: 'PAYMENT_EXCEEDS_DUE' });
      }
      const saleRef: SaleRef = { id: sale.id, type: sale.type, status: sale.status, contact_id: sale.contact_id };
      // Parent payment (contact payments split over invoices) follows the change.
      if (payment.parent_id) {
        const parent = await tx.transaction_payments.findFirst({ where: { id: payment.parent_id } });
        if (parent) await tx.transaction_payments.update({ where: { id: parent.id }, data: { amount: parent.amount.sub(payment.amount.sub(amount)), updated_at: new Date() } });
      }
      await this.editLine(tx, ctx, saleRef, payment, { ...dto, amount: amount.toFixed(), isReturn: payment.is_return });
      await this.refreshPaymentStatus(tx, sale.id, sale.final_total);
      return sale.id;
    }, TX_OPTIONS);
    return this.listForSale(user, saleId);
  }

  /** DELETE /sale-payments/:id */
  async remove(user: AuthUser, paymentId: number) {
    const db = this.prisma.forTenant(user.businessId);
    const saleId = await db.$transaction(async (tx) => {
      const payment = await tx.transaction_payments.findFirst({ where: { id: paymentId } });
      if (!payment || !payment.transaction_id) throw new NotFoundException('Payment not found');
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${payment.transaction_id} AND business_id = ${user.businessId} FOR UPDATE`;
      const sale = await tx.transactions.findFirst({ where: { id: payment.transaction_id, type: 'sell' }, select: { id: true, final_total: true } });
      if (!sale) throw new NotFoundException('Payment not found');
      await this.deleteLine(tx, payment);
      await this.refreshPaymentStatus(tx, sale.id, sale.final_total);
      return sale.id;
    }, TX_OPTIONS);
    return this.listForSale(user, saleId);
  }

  private present(p: Prisma.transaction_paymentsGetPayload<object>) {
    return {
      id: p.id,
      transactionId: p.transaction_id,
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
      createdBy: p.created_by,
      parentId: p.parent_id,
    };
  }
}
