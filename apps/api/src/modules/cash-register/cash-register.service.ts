import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../common/tenant-db';
import type { AuthUser } from '../../common/types';
import {
  buildSellPaymentRows,
  needsPreviousRows,
  planRegisterSync,
  syncAction,
  type RegisterRowData,
  type RowByMethodAndType,
} from './cash-register.rules';

/** A payment line as the sales module hands it over (amounts are decimal strings or numbers, never floats in arithmetic). */
export interface RegisterPaymentInput {
  method: string;
  amount: string | number;
  isReturn?: boolean;
}

/** The sale/expense a payment belongs to. */
export interface RegisterTransactionRef {
  id: number;
  type: string;
  status?: string;
}

/**
 * CONTRACT between the Sales module and the Cash register module.
 * The Sales module calls these inside its own database transaction (`tx`), so a failed sale never leaves
 * register rows behind. Behaviour = Laravel `CashRegisterUtil`
 * (countOpenedRegister, addSellPayments, updateSellPayments, getCurrentCashRegister).
 *
 * No constructor dependencies on purpose: everything goes through the caller's `tx`. The register screens (open, details,
 * close, report) live in `RegistersService`.
 */
@Injectable()
export class CashRegisterService {
  /** The user's open register (status 'open'), or null when none is open. Laravel: getCurrentCashRegister / countOpenedRegister. */
  async getOpenRegister(tx: TenantTx, user: AuthUser): Promise<{ id: number } | null> {
    return tx.cash_registers.findFirst({ where: { user_id: user.id, status: 'open' }, select: { id: true }, orderBy: { id: 'asc' } });
  }

  /** Writes cash_register_transactions rows for the payments of a new sale. Laravel: addSellPayments. No-op when no register is open. */
  async addSellPayments(tx: TenantTx, user: AuthUser, transaction: RegisterTransactionRef, payments: RegisterPaymentInput[]): Promise<void> {
    const register = await this.getOpenRegister(tx, user);
    if (!register) return;
    await this.insertRows(tx, register.id, buildSellPaymentRows(transaction, payments));
  }

  /**
   * Re-syncs the register rows of an edited sale. Laravel: updateSellPayments($status_before, ...).
   * draft -> final adds all payments; final -> draft refunds them; final -> final books the difference.
   * `transaction.status` is the status the sale has NOW. No-op when no register is open.
   */
  async updateSellPayments(
    tx: TenantTx,
    user: AuthUser,
    statusBefore: string,
    transaction: RegisterTransactionRef,
    payments: RegisterPaymentInput[],
  ): Promise<void> {
    const register = await this.getOpenRegister(tx, user);
    if (!register) return;

    const previousRows = needsPreviousRows(syncAction(statusBefore, transaction.status)) ? await this.previousRows(tx, user, transaction.id) : [];
    await this.insertRows(tx, register.id, planRegisterSync({ statusBefore, transaction, payments, previousRows }));
  }

  /** Everything the registers already hold for one transaction, grouped by method and credit/debit. */
  private async previousRows(tx: TenantTx, user: AuthUser, transactionId: number): Promise<RowByMethodAndType[]> {
    // cash_register_transactions has no business_id: the register it belongs to carries the tenant.
    const rows = await tx.cash_register_transactions.findMany({
      where: { transaction_id: transactionId, cash_registers: { business_id: user.businessId } },
      select: { pay_method: true, type: true, amount: true },
    });
    return rows.map((r) => ({ pay_method: r.pay_method, type: r.type, amount: r.amount }));
  }

  private async insertRows(tx: TenantTx, registerId: number, rows: RegisterRowData[]): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    await tx.cash_register_transactions.createMany({
      data: rows.map((r) => ({
        cash_register_id: registerId,
        amount: r.amount,
        pay_method: r.pay_method,
        type: r.type,
        transaction_type: r.transaction_type,
        transaction_id: r.transaction_id,
        created_at: now,
        updated_at: now,
      })),
    });
  }
}
