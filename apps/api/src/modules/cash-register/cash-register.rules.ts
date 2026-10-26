import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { wallClockToInstant } from '../../common/time';

/**
 * Pure cash register rules, ported from Laravel `CashRegisterUtil` (addSellPayments, updateSellPayments, refundSell,
 * getRegisterDetails), `TransactionUtil::registerReport` and `CashRegisterController::postCloseRegister`.
 * Money is always Prisma.Decimal; nothing here touches the database.
 */

type D = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

/** Payment methods Laravel keeps totals for, in the order the register screens list them. */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'cheque',
  'bank_transfer',
  'other',
  'advance',
  'custom_pay_1',
  'custom_pay_2',
  'custom_pay_3',
  'custom_pay_4',
  'custom_pay_5',
  'custom_pay_6',
  'custom_pay_7',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** `refundSell` (sale goes final -> draft) refunds everything except the advance balance. */
const REFUND_ALL_METHODS: readonly string[] = PAYMENT_METHODS.filter((m) => m !== 'advance');

export type RowType = 'credit' | 'debit';

/** A row to insert into cash_register_transactions (the register id is added by the caller). */
export interface RegisterRowData {
  amount: D;
  pay_method: string;
  type: RowType;
  transaction_type: string;
  transaction_id: number;
}

export interface PaymentLine {
  method: string;
  amount: string | number | D;
  isReturn?: boolean;
}

export interface TransactionRef {
  id: number;
  type: string;
  status?: string;
}

/** Parses an amount. Throws a 400 for anything that is not a finite number. */
export function toDecimal(v: string | number | D | null | undefined): D {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return ZERO;
  try {
    const d = new Prisma.Decimal(typeof v === 'string' ? v.trim() : v);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new BadRequestException(`"${String(v)}" is not a valid number`);
  }
}

/** Database precision of money columns: 4 decimals, half up (Laravel number_format). */
export function round4(d: D): D {
  return d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** Decimal -> plain string (never exponent notation) for JSON responses. */
export function money(d: D | string | number | null | undefined): string {
  return new Prisma.Decimal(d ?? 0).toFixed();
}

// ----------------------------------------------------------------------------------------------------------------
// Payment rows (CashRegisterUtil::addSellPayments)
// ----------------------------------------------------------------------------------------------------------------

/**
 * One row per non-zero payment. A return payment (change given back) is stored negative. Expenses are cash going out
 * (debit); everything else is a credit. `transaction_type` is the type of the transaction (sell, expense, ...).
 */
export function buildSellPaymentRows(transaction: TransactionRef, payments: readonly PaymentLine[]): RegisterRowData[] {
  const rows: RegisterRowData[] = [];
  for (const p of payments) {
    const value = round4(toDecimal(p.amount));
    const amount = p.isReturn ? value.neg() : value;
    if (amount.isZero()) continue;
    rows.push({
      amount,
      pay_method: p.method,
      type: transaction.type === 'expense' ? 'debit' : 'credit',
      transaction_type: transaction.type,
      transaction_id: transaction.id,
    });
  }
  return rows;
}

/** A grouped aggregate of a transaction's existing register rows. */
export interface RowByMethodAndType {
  pay_method: string | null;
  type: RowType;
  amount: D;
}

/** Net money per method already recorded for a transaction: credits minus debits (the SUM(IF(type='credit', ...)) of Laravel). */
export function netByMethod(rows: readonly RowByMethodAndType[]): Record<string, D> {
  const net: Record<string, D> = {};
  for (const r of rows) {
    if (!r.pay_method) continue;
    const signed = r.type === 'credit' ? r.amount : r.amount.neg();
    net[r.pay_method] = (net[r.pay_method] ?? ZERO).add(signed);
  }
  return net;
}

export type SyncAction = 'none' | 'add_all' | 'refund_all' | 'diff';

/** Which of Laravel's three cases applies when a sale is saved again. */
export function syncAction(statusBefore: string, statusNow: string | undefined): SyncAction {
  if (statusBefore === 'draft' && statusNow === 'final') return 'add_all';
  if (statusBefore === 'final' && statusNow === 'draft') return 'refund_all';
  if (statusBefore === 'final' && statusNow === 'final') return 'diff';
  return 'none';
}

/** Whether the planner needs the transaction's existing register rows (so the service only reads them when required). */
export function needsPreviousRows(action: SyncAction): boolean {
  return action === 'refund_all' || action === 'diff';
}

/**
 * Rows to write when an existing sale is saved again (CashRegisterUtil::updateSellPayments).
 *  - draft -> final: add every payment;
 *  - final -> draft: refund what the sale had taken (refundSell);
 *  - final -> final: compare what the register holds for the sale with the payments now on it; the difference becomes a
 *    refund (money went back out) or an additional sell credit (more was paid).
 * `previousRows` are the sale's rows grouped by method and type.
 */
export function planRegisterSync(args: {
  statusBefore: string;
  transaction: TransactionRef;
  payments: readonly PaymentLine[];
  previousRows: readonly RowByMethodAndType[];
}): RegisterRowData[] {
  const { statusBefore, transaction, payments, previousRows } = args;
  const action = syncAction(statusBefore, transaction.status);
  const txId = transaction.id;

  if (action === 'add_all') return buildSellPaymentRows(transaction, payments);

  if (action === 'refund_all') {
    const net = netByMethod(previousRows);
    const rows: RegisterRowData[] = [];
    for (const method of REFUND_ALL_METHODS) {
      const value = net[method];
      if (value && value.gt(0)) rows.push({ amount: value, pay_method: method, type: 'debit', transaction_type: 'refund', transaction_id: txId });
    }
    return rows;
  }

  if (action === 'diff') {
    const diffs: Record<string, D> = { ...netByMethod(previousRows) };
    for (const m of PAYMENT_METHODS) diffs[m] = diffs[m] ?? ZERO;
    for (const p of payments) {
      const value = round4(toDecimal(p.amount));
      const current = diffs[p.method] ?? ZERO;
      // A return line (change given back) puts money back into the difference, a normal payment takes it out.
      diffs[p.method] = p.isReturn ? current.add(value) : current.sub(value);
    }
    const rows: RegisterRowData[] = [];
    for (const [method, value] of Object.entries(diffs)) {
      if (value.gt(0)) rows.push({ amount: value, pay_method: method, type: 'debit', transaction_type: 'refund', transaction_id: txId });
      else if (value.lt(0)) rows.push({ amount: value.neg(), pay_method: method, type: 'credit', transaction_type: 'sell', transaction_id: txId });
    }
    return rows;
  }

  return [];
}

// ----------------------------------------------------------------------------------------------------------------
// Totals (CashRegisterUtil::getRegisterDetails)
// ----------------------------------------------------------------------------------------------------------------

/** cash_register_transactions grouped by method and transaction type (what the service reads from the database). */
export interface RowGroup {
  payMethod: string | null;
  transactionType: string | null;
  amount: D;
  count: number;
}

export interface MethodTotals {
  method: PaymentMethod;
  /** transaction_type = 'sell' */
  sale: D;
  /** transaction_type = 'expense' */
  expense: D;
  /** transaction_type = 'refund' */
  refund: D;
}

export interface RegisterTotals {
  cashInHand: D;
  /** sell rows minus refund rows (all methods) */
  totalSale: D;
  totalExpense: D;
  totalRefund: D;
  methods: MethodTotals[];
  /** number of rows paid by card / cheque (the slip and cheque counts the close form starts with) */
  cardSlips: number;
  cheques: number;
  /** cash_in_hand + cash sales - cash refunds (the "Total payment" line) */
  totalPayment: D;
  /** cash_in_hand + cash sales - cash refunds - cash expenses: what the close form suggests as the closing amount */
  suggestedClosingAmount: D;
  /** sales before refunds (total_sale + total_refund), as the "Total = ..." line of the screen prints it */
  grossSale: D;
  /** cash_in_hand + total_sale - total_expense */
  expectedTotal: D;
}

export function computeRegisterTotals(groups: readonly RowGroup[]): RegisterTotals {
  const sum = (pred: (g: RowGroup) => boolean): D => groups.filter(pred).reduce((acc, g) => acc.add(g.amount), ZERO);
  const count = (pred: (g: RowGroup) => boolean): number => groups.filter(pred).reduce((acc, g) => acc + g.count, 0);

  const methods: MethodTotals[] = PAYMENT_METHODS.map((method) => ({
    method,
    sale: sum((g) => g.payMethod === method && g.transactionType === 'sell'),
    expense: sum((g) => g.payMethod === method && g.transactionType === 'expense'),
    refund: sum((g) => g.payMethod === method && g.transactionType === 'refund'),
  }));
  const cash = methods[0];

  const cashInHand = sum((g) => g.transactionType === 'initial');
  const sells = sum((g) => g.transactionType === 'sell');
  const totalRefund = sum((g) => g.transactionType === 'refund');
  const totalSale = sells.sub(totalRefund);
  const totalExpense = sum((g) => g.transactionType === 'expense');

  return {
    cashInHand,
    totalSale,
    totalExpense,
    totalRefund,
    methods,
    cardSlips: count((g) => g.payMethod === 'card'),
    cheques: count((g) => g.payMethod === 'cheque'),
    totalPayment: cashInHand.add(cash.sale).sub(cash.refund),
    suggestedClosingAmount: cashInHand.add(cash.sale).sub(cash.refund).sub(cash.expense),
    grossSale: totalSale.add(totalRefund),
    expectedTotal: cashInHand.add(totalSale).sub(totalExpense),
  };
}

/** Credit sales = what the sales of the shift total minus what was actually collected into the register. */
export function creditSales(totalSalesOfShift: D, totalSale: D): D {
  return totalSalesOfShift.sub(totalSale);
}

/** Row of the register report: sell money per method and their sum (TransactionUtil::registerReport + the `total` column). */
export interface ReportTotals {
  methods: Record<PaymentMethod, string>;
  total: string;
}

export function reportRowTotals(groups: readonly RowGroup[]): ReportTotals {
  const methods = {} as Record<PaymentMethod, string>;
  let total = ZERO;
  for (const m of PAYMENT_METHODS) {
    const v = groups.filter((g) => g.payMethod === m && g.transactionType === 'sell').reduce((acc, g) => acc.add(g.amount), ZERO);
    methods[m] = money(v);
    total = total.add(v);
  }
  return { methods, total: money(total) };
}

// ----------------------------------------------------------------------------------------------------------------
// Opening a register
// ----------------------------------------------------------------------------------------------------------------

/** Opening cash: a non-negative amount (Laravel stores a row only when it is not zero). */
export function validateInitialAmount(raw: string | number | undefined | null): D {
  const amount = round4(toDecimal(raw));
  if (amount.lt(0)) throw new BadRequestException('Cash in hand cannot be negative');
  return amount;
}

/**
 * Location of a new register: the requested one must be among the locations the user may use; without a request the
 * user's only location is taken. Laravel shows the location select only when there is more than one.
 */
export function pickRegisterLocation(requested: number | undefined | null, allowedIds: readonly number[]): number {
  if (allowedIds.length === 0) throw new BadRequestException('No business location is available for this user');
  if (requested === undefined || requested === null) {
    if (allowedIds.length === 1) return allowedIds[0];
    throw new BadRequestException('Select the business location of the register');
  }
  if (!allowedIds.includes(requested)) throw new BadRequestException('You cannot open a register at this location');
  return requested;
}

/** Laravel opens the register at `Y-m-d H:i:00`: seconds are cut off. */
export function floorToMinute(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCSeconds(0, 0);
  return out;
}

// ----------------------------------------------------------------------------------------------------------------
// Closing a register
// ----------------------------------------------------------------------------------------------------------------

export interface CloseInput {
  closingAmount: string | number;
  totalCardSlips: number;
  totalCheques: number;
  closingNote?: string | null;
  denominations?: Record<string, number | string | null | undefined> | null;
}

export interface NormalizedClose {
  closing_amount: D;
  total_card_slips: number;
  total_cheques: number;
  closing_note: string | null;
  denominations: string | null;
}

export function assertRegisterOpen(status: string): void {
  if (status !== 'open') throw new BadRequestException('This register is already closed');
}

/** Validates and normalises the close form (closing_amount, total_card_slips, total_cheques, closing_note, denominations). */
export function validateCloseInput(input: CloseInput): NormalizedClose {
  const closingAmount = round4(toDecimal(input.closingAmount));
  if (closingAmount.lt(0)) throw new BadRequestException('Closing cash cannot be negative');
  for (const [label, n] of [['Card slips', input.totalCardSlips], ['Cheques', input.totalCheques]] as const) {
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new BadRequestException(`${label} must be a whole number of zero or more`);
  }
  const note = input.closingNote?.trim() ?? '';
  if (note.length > 5000) throw new BadRequestException('Closing note is too long');
  return {
    closing_amount: closingAmount,
    total_card_slips: input.totalCardSlips,
    total_cheques: input.totalCheques,
    closing_note: note === '' ? null : note,
    denominations: encodeDenominations(input.denominations),
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Cash denominations
// ----------------------------------------------------------------------------------------------------------------

export interface DenominationRow {
  denomination: string;
  count: number;
  subtotal: string;
}

function parseCount(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException('Denomination counts must be whole numbers of zero or more');
  return n;
}

/**
 * Close form `denominations[<note value>] = <count>` -> JSON stored in cash_registers.denominations (null when nothing was
 * counted). Keys must be positive amounts.
 */
export function encodeDenominations(input: Record<string, number | string | null | undefined> | null | undefined): string | null {
  if (!input) return null;
  const entries = Object.entries(input);
  if (entries.length > 50) throw new BadRequestException('Too many denominations');
  const out: Record<string, number> = {};
  for (const [key, raw] of entries) {
    const value = toDecimal(key);
    if (value.lte(0)) throw new BadRequestException(`"${key}" is not a valid denomination`);
    const count = parseCount(raw);
    if (count > 0) out[value.toFixed()] = count;
  }
  return Object.keys(out).length === 0 ? null : JSON.stringify(out);
}

/** Stored JSON -> rows (largest note first). Tolerates the blank values Laravel's form saves and anything unreadable. */
export function parseDenominations(stored: string | null | undefined): DenominationRow[] {
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const rows: { value: D; count: number }[] = [];
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    let value: D;
    try {
      value = new Prisma.Decimal(key);
    } catch {
      continue;
    }
    const n = Number(raw ?? 0);
    rows.push({ value, count: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
  }
  rows.sort((a, b) => b.value.comparedTo(a.value));
  return rows.map((r) => ({ denomination: r.value.toFixed(), count: r.count, subtotal: money(r.value.mul(r.count)) }));
}

export function denominationsTotal(rows: readonly DenominationRow[]): D {
  return rows.reduce((acc, r) => acc.add(r.subtotal), ZERO);
}

/** pos_settings.cash_denominations ("1000,500,100") -> the note values to show on the close form. */
export function configuredDenominations(posSettings: unknown): string[] {
  if (posSettings === null || typeof posSettings !== 'object') return [];
  const raw = (posSettings as Record<string, unknown>).cash_denominations;
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const p = part.trim();
    if (p === '') continue;
    try {
      const d = new Prisma.Decimal(p);
      if (d.gt(0)) seen.add(d.toFixed());
    } catch {
      // ignore junk
    }
  }
  return [...seen].sort((a, b) => new Prisma.Decimal(b).comparedTo(a));
}

// ----------------------------------------------------------------------------------------------------------------
// Access, names, dates
// ----------------------------------------------------------------------------------------------------------------

/**
 * A register may be looked at / closed by its own cashier, or by someone who may work at its location. (Laravel only
 * hides the report rows of other locations; the detail routes were not checked at all.)
 */
export function canAccessRegister(
  register: { userId: number | null; locationId: number | null },
  userId: number,
  permitted: 'all' | readonly number[],
): boolean {
  if (register.userId === userId) return true;
  if (permitted === 'all') return true;
  return register.locationId !== null && permitted.includes(register.locationId);
}

export function assertCanAccessRegister(
  register: { userId: number | null; locationId: number | null },
  userId: number,
  permitted: 'all' | readonly number[],
): void {
  if (!canAccessRegister(register, userId, permitted)) throw new ForbiddenException('You cannot access this register');
}

/** CONCAT(surname, first_name, last_name) without the empty parts. */
export function userDisplayName(u: { surname?: string | null; first_name?: string | null; last_name?: string | null }): string {
  return [u.surname, u.first_name, u.last_name]
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join(' ');
}

/**
 * `YYYY-MM-DD` start / end (the report's date range, whole days in the business time zone) -> half-open instants
 * [from, to). Laravel compares the DATE of created_at, which is the same thing.
 */
export function dayRangeInstants(startDate: string | undefined, endDate: string | undefined, tz: string): { from?: Date; to?: Date } {
  const parse = (s: string): Date => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new BadRequestException('Dates must be given as YYYY-MM-DD');
    const wall = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(wall.getTime()) || wall.getUTCDate() !== Number(m[3])) throw new BadRequestException(`"${s}" is not a valid date`);
    return wall;
  };
  const out: { from?: Date; to?: Date } = {};
  if (startDate) out.from = wallClockToInstant(parse(startDate), tz);
  if (endDate) {
    const nextDay = parse(endDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    out.to = wallClockToInstant(nextDay, tz);
  }
  return out;
}

/** business.custom_labels -> the labels of the custom payment methods (blank when the business named none). */
export function customPaymentLabels(customLabels: string | null | undefined): Record<string, string> {
  if (!customLabels) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(customLabels);
  } catch {
    return {};
  }
  const payments = (parsed as { payments?: Record<string, unknown> } | null)?.payments;
  if (!payments || typeof payments !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(payments)) {
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

export interface PaymentTypeInfo {
  method: PaymentMethod;
  /** Custom label when the business named the method, else null (the screen translates the standard names). */
  label: string | null;
}

/**
 * Methods the register screens list (Util::payment_types with advance): the standard ones are always shown; a custom method
 * is shown when the location has it enabled (default_payment_accounts[key].is_enabled). Without a location all are shown.
 */
export function visiblePaymentTypes(
  labels: Record<string, string>,
  locationAccounts: string | null | undefined,
  hasLocation: boolean,
): PaymentTypeInfo[] {
  let enabled: Record<string, { is_enabled?: unknown } | undefined> = {};
  if (hasLocation && locationAccounts) {
    try {
      const parsed: unknown = JSON.parse(locationAccounts);
      if (parsed && typeof parsed === 'object') enabled = parsed as typeof enabled;
    } catch {
      enabled = {};
    }
  }
  return PAYMENT_METHODS.filter((m) => {
    if (!m.startsWith('custom_pay_') || !hasLocation) return true;
    const flag = enabled[m]?.is_enabled;
    return flag === true || flag === 1 || flag === '1';
  }).map((method) => ({ method, label: labels[method] ?? null }));
}

// ----------------------------------------------------------------------------------------------------------------
// Shift (products sold) figures
// ----------------------------------------------------------------------------------------------------------------

/**
 * "Grand total" under the products-sold tables of the register details: the sum of the product lines plus the order tax and
 * shipping of the shift's sales, minus their discount (register_product_details.blade.php).
 */
export function shiftGrandTotal(lineAmounts: readonly D[], totalTax: D, totalDiscount: D, totalShipping: D): D {
  return lineAmounts.reduce((acc, a) => acc.add(a), ZERO).add(totalTax).sub(totalDiscount).add(totalShipping);
}
