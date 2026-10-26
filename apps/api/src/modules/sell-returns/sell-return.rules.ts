import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { wallClockToInstant } from '../../common/time';

/**
 * Business rules of a sell return, ported from Laravel (`SellReturnController`, `TransactionUtil::addSellReturn`,
 * `updateQuantitySoldFromSellLine`, `ProductUtil::calculateInvoiceTotal / updateProductQuantity`,
 * `TransactionUtil::calculatePaymentStatus`). Pure functions on Prisma.Decimal: no database, no floats.
 *
 * Laravel keeps ONE `sell_return` transaction per sale (`return_parent_id` = the sale). Saving the return form again
 * edits that same transaction: the quantities in the form REPLACE what was returned before ("set", not "add").
 */

export type Dec = Prisma.Decimal;
export type Decimalish = Prisma.Decimal.Value | null | undefined;

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export const dec = (v: Decimalish): Dec => new Prisma.Decimal(v ?? 0);

/** Amounts are stored with 4 decimals (half up, like MySQL's DECIMAL(22,4) rounding of Laravel's floats). */
export const round4 = (d: Dec): Dec => d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

// ------------------------------------------------------------------------------------------------ permissions

export type CanFn = (permission: string) => boolean;

/** Laravel: `access_sell_return` (all returns) or `access_own_sell_return` (only returns the user created). */
export const RETURN_PERMISSIONS = ['access_sell_return', 'access_own_sell_return'] as const;

/** `null` = no access, 'all' = every return, 'own' = only the returns created by the user. */
export function returnAccessScope(can: CanFn): 'all' | 'own' | null {
  if (can('access_sell_return')) return 'all';
  if (can('access_own_sell_return')) return 'own';
  return null;
}

/**
 * Sales the user may pick for a return (Laravel `validateInvoiceToReturn`): a user without `direct_sell.access` who holds
 * `view_own_sell_only` only sees the sales they created.
 */
export function saleVisibilityScope(can: CanFn): 'all' | 'own' {
  return !can('direct_sell.access') && can('view_own_sell_only') ? 'own' : 'all';
}

// ------------------------------------------------------------------------------------------------ discount + totals

export type DiscountType = 'fixed' | 'percentage';

export interface NormalizedDiscount {
  type: DiscountType | null;
  amount: Dec;
}

/**
 * The discount of the return form. A missing type means Laravel's default (`fixed`); an empty type ("None") means no discount.
 * A percentage must be 0..100 and the amount cannot be negative.
 */
export function normalizeDiscount(type: string | null | undefined, amount: Decimalish): NormalizedDiscount {
  if (type === '' || type === null) return { type: null, amount: ZERO };
  const t = type === undefined ? 'fixed' : type;
  if (t !== 'fixed' && t !== 'percentage') throw new BadRequestException('Discount type must be fixed or percentage');
  const a = dec(amount);
  if (a.isNegative()) throw new BadRequestException('Discount cannot be negative');
  if (t === 'percentage' && a.gt(HUNDRED)) throw new BadRequestException('A percentage discount cannot be more than 100');
  return { type: t, amount: a };
}

export interface ReturnLineAmount {
  /** Quantity in base units (sub-unit quantity already multiplied by the unit multiplier). */
  quantity: Dec;
  unitPriceIncTax: Dec;
}

export interface ReturnTotals {
  totalBeforeTax: Dec;
  discount: Dec;
  tax: Dec;
  finalTotal: Dec;
}

/**
 * `ProductUtil::calculateInvoiceTotal`:
 *   total_before_tax = sum(quantity * unit_price_inc_tax)
 *   discount         = fixed ? amount : amount/100 * total_before_tax
 *   tax              = tax% / 100 * (total_before_tax - discount)      (the tax of the parent sale)
 *   final_total      = total_before_tax + tax - discount
 * Everything is computed exactly and rounded once to 4 decimals at the end (the database rounds the same way).
 */
export function computeReturnTotals(lines: readonly ReturnLineAmount[], discount: NormalizedDiscount, taxPercent: Decimalish): ReturnTotals {
  let tbt = ZERO;
  for (const l of lines) tbt = tbt.add(l.quantity.mul(l.unitPriceIncTax));

  let disc = ZERO;
  if (discount.type === 'fixed') disc = discount.amount;
  else if (discount.type === 'percentage') disc = discount.amount.mul(tbt).div(HUNDRED);

  const rate = dec(taxPercent);
  const tax = rate.isZero() ? ZERO : rate.mul(tbt.sub(disc)).div(HUNDRED);
  const final = tbt.add(tax).sub(disc);
  return { totalBeforeTax: round4(tbt), discount: round4(disc), tax: round4(tax), finalTotal: round4(final) };
}

/** A fixed discount larger than the returned value would make the return total negative. */
export function assertTotalsSane(totals: ReturnTotals): void {
  if (totals.discount.gt(totals.totalBeforeTax)) throw new BadRequestException('The return discount cannot be more than the value of the returned items');
}

/** The discount that was applied, recovered from the stored totals (final = total_before_tax + tax - discount). */
export function discountFromStored(totalBeforeTax: Decimalish, taxAmount: Decimalish, finalTotal: Decimalish): Dec {
  return round4(dec(totalBeforeTax).add(dec(taxAmount)).sub(dec(finalTotal)));
}

export interface SubTax {
  id: number;
  name: string;
  amount: Dec;
}

/** `Util::groupTaxDetails`: a tax group's amount is split between its sub taxes in proportion to their rates. */
export function groupTaxBreakdown(subTaxes: readonly SubTax[], taxAmount: Decimalish): { id: number; name: string; rate: string; amount: string }[] {
  const sum = subTaxes.reduce((s, t) => s.add(t.amount), ZERO);
  const total = dec(taxAmount);
  return subTaxes.map((t) => ({
    id: t.id,
    name: t.name,
    rate: t.amount.toString(),
    amount: (sum.isZero() ? ZERO : round4(total.div(sum).mul(t.amount))).toString(),
  }));
}

// ------------------------------------------------------------------------------------------------ quantities

export interface SaleLineFacts {
  id: number;
  /** Quantity sold, base units. */
  quantity: Dec;
  /** Quantity returned so far, base units. */
  quantityReturned: Dec;
  unitPriceIncTax: Dec;
  /** Sub unit multiplier (`base_unit_multiplier`) or 1. */
  multiplier: Dec;
  /** Whether the unit shown on the line (sub unit, else product unit) allows decimals. */
  allowDecimal: boolean;
}

export interface RequestedReturnLine {
  sellLineId: number;
  /** Quantity in the unit shown on the sale line (a sub unit quantity when the line was sold in a sub unit). */
  quantity: Decimalish;
}

export interface ResolvedReturnLine {
  line: SaleLineFacts;
  /** New quantity returned, base units. */
  newQuantity: Dec;
  /** newQuantity - quantityReturned (positive = more stock comes back). */
  difference: Dec;
}

/** Quantity of a sale line as shown in its own unit (sub unit aware), 4 decimals. */
export function displayQuantity(baseQuantity: Dec, multiplier: Dec): Dec {
  return (multiplier.isZero() ? baseQuantity : baseQuantity.div(multiplier)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Validates the quantities of the return form against the sale and converts them to base units.
 * Laravel only checks this in the browser (`max = quantity sold`, no decimals when the unit forbids them); here it is enforced.
 * Lines missing from the request are treated as 0 returned, so the request always describes the whole return.
 * Returns one entry per sale line (also the unchanged ones) so totals and stock are computed from the same list.
 */
export function resolveReturnQuantities(lines: readonly SaleLineFacts[], requested: readonly RequestedReturnLine[]): ResolvedReturnLine[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const wanted = new Map<number, Dec>();
  for (const r of requested) {
    const line = byId.get(r.sellLineId);
    if (!line) throw new BadRequestException(`Sell line ${r.sellLineId} does not belong to this sale`);
    if (wanted.has(r.sellLineId)) throw new BadRequestException(`Sell line ${r.sellLineId} is listed twice`);
    let q: Dec;
    try {
      q = dec(r.quantity);
    } catch {
      throw new BadRequestException(`Quantity of sell line ${r.sellLineId} is not a number`);
    }
    if (!q.isFinite() || q.isNegative()) throw new BadRequestException('Return quantity cannot be negative');
    if (q.decimalPlaces() > 4) throw new BadRequestException('Return quantity can have at most 4 decimals');
    if (!line.allowDecimal && !q.isInteger()) throw new BadRequestException('Decimal quantity is not allowed for this unit');
    wanted.set(r.sellLineId, q);
  }

  return lines.map((line) => {
    const q = wanted.get(line.id) ?? ZERO;
    let base = q.mul(line.multiplier);
    // The form shows the sold quantity rounded to 4 decimals; returning "all" of it must mean exactly all.
    if (!base.eq(line.quantity) && q.eq(displayQuantity(line.quantity, line.multiplier))) base = line.quantity;
    if (base.gt(line.quantity)) {
      throw new BadRequestException(`Return quantity of sell line ${line.id} is more than the quantity sold (${displayQuantity(line.quantity, line.multiplier).toString()})`);
    }
    return { line, newQuantity: base, difference: base.sub(line.quantityReturned) };
  });
}

export function hasReturnedQuantity(resolved: readonly ResolvedReturnLine[]): boolean {
  return resolved.some((r) => r.newQuantity.gt(0));
}

// ------------------------------------------------------------------------------------------------ FIFO mapping

export interface SellPurchaseMapping {
  /** transaction_sell_lines_purchase_lines.id */
  id: number;
  purchaseLineId: number;
  quantity: Dec;
  qtyReturned: Dec;
}

export interface MappingUpdate {
  mappingId: number;
  purchaseLineId: number;
  /** Added to `transaction_sell_lines_purchase_lines.qty_returned`. */
  qtyReturnedDelta: Dec;
  /** Added to `purchase_lines.quantity_sold` (negative when stock is returned to the lot). */
  quantitySoldDelta: Dec;
}

export interface MappingPlan {
  updates: MappingUpdate[];
  /** Quantity that no mapping row could absorb (legacy rows without FIFO mapping). Laravel ignores it silently. */
  unallocated: Dec;
}

/**
 * `TransactionUtil::updateQuantitySoldFromSellLine`. `difference` is new - old returned quantity (base units).
 *  - difference > 0: goods come back; walk the mapping rows in order and raise `qty_returned` up to each row's sold quantity,
 *    lowering `quantity_sold` of the purchase line by the same amount.
 *  - difference < 0: a return is reduced/removed; walk the rows in order and take `qty_returned` back, raising `quantity_sold`.
 * (Laravel adds the full mapping quantity back to `quantity_sold` in the second case when a row is emptied, which over-counts
 * rows that were only partly returned; here exactly the returned amount is restored.)
 */
export function planMappingChange(mappings: readonly SellPurchaseMapping[], difference: Dec): MappingPlan {
  const updates: MappingUpdate[] = [];
  if (difference.isZero()) return { updates, unallocated: ZERO };
  let left = difference.abs();

  for (const m of mappings) {
    if (left.lte(0)) break;
    if (difference.gt(0)) {
      const room = m.quantity.sub(m.qtyReturned);
      if (room.lte(0)) continue;
      const take = Prisma.Decimal.min(room, left);
      updates.push({ mappingId: m.id, purchaseLineId: m.purchaseLineId, qtyReturnedDelta: take, quantitySoldDelta: take.neg() });
      left = left.sub(take);
    } else {
      if (m.qtyReturned.lte(0)) continue;
      const take = Prisma.Decimal.min(m.qtyReturned, left);
      updates.push({ mappingId: m.id, purchaseLineId: m.purchaseLineId, qtyReturnedDelta: take.neg(), quantitySoldDelta: take });
      left = left.sub(take);
    }
  }
  return { updates, unallocated: left };
}

/** Applies a plan to mapping rows in memory (used by tests and by the service to know the resulting state). */
export function applyMappingPlan(mappings: readonly SellPurchaseMapping[], plan: MappingPlan): SellPurchaseMapping[] {
  return mappings.map((m) => {
    const delta = plan.updates.filter((u) => u.mappingId === m.id).reduce((s, u) => s.add(u.qtyReturnedDelta), ZERO);
    return { ...m, qtyReturned: m.qtyReturned.add(delta) };
  });
}

// ------------------------------------------------------------------------------------------------ stock

/**
 * `ProductUtil::updateProductQuantity`: only products with stock management change `qty_available`.
 * A return puts the difference back at the sale's location (positive = stock up, negative = stock down).
 */
export function stockChange(enableStock: boolean, difference: Dec): Dec {
  return enableStock ? difference : ZERO;
}

// ------------------------------------------------------------------------------------------------ payments

export type PaymentStatus = 'paid' | 'partial' | 'due';

export interface PaymentAmount {
  amount: Decimalish;
  isReturn?: boolean | null;
}

/** `TransactionUtil::getTotalPaid`: a payment flagged `is_return` (change given back) counts negative. */
export function netPaid(payments: readonly PaymentAmount[]): Dec {
  return payments.reduce((s, p) => (p.isReturn ? s.sub(dec(p.amount)) : s.add(dec(p.amount))), ZERO);
}

/** `TransactionUtil::calculatePaymentStatus`: paid when final_total <= paid, partial when something is paid, else due. */
export function calculatePaymentStatus(finalTotal: Decimalish, totalPaid: Decimalish): PaymentStatus {
  const final = dec(finalTotal);
  const paid = dec(totalPaid);
  if (final.lte(paid)) return 'paid';
  if (paid.gt(0) && final.gt(paid)) return 'partial';
  return 'due';
}

/** Amount still to refund to the customer (never negative). */
export function refundDue(finalTotal: Decimalish, totalPaid: Decimalish): Dec {
  const due = dec(finalTotal).sub(dec(totalPaid));
  return due.isNegative() ? ZERO : due;
}

/**
 * A refund payment on a return. Laravel ignores a payment when the return is already paid and does not cap the amount;
 * here an amount above what is still due is refused so a return can never be over-refunded.
 */
export function validateRefundPayment(input: { amount: Decimalish; status: string | null; finalTotal: Decimalish; totalPaid: Decimalish }): Dec {
  const amount = dec(input.amount);
  if (!amount.isFinite() || amount.lte(0)) throw new BadRequestException('Payment amount must be more than zero');
  if (amount.decimalPlaces() > 4) throw new BadRequestException('Payment amount can have at most 4 decimals');
  if (input.status === 'paid') throw new BadRequestException('This return is already fully refunded');
  const due = refundDue(input.finalTotal, input.totalPaid);
  if (amount.gt(due)) throw new BadRequestException(`The amount is more than the balance still to refund (${due.toString()})`);
  return amount;
}

// ------------------------------------------------------------------------------------------------ reward points

export interface RewardSettings {
  enableRp: boolean;
  minOrderTotalForRp: Decimalish;
  amountForUnitRp: Decimalish;
  maxRpPerOrder: number | null;
  rpExpiryPeriod: number | null;
  rpExpiryType: string | null;
}

/** `TransactionUtil::calculateRewardPoints`. */
export function calculateRewardPoints(s: RewardSettings, total: Decimalish): number {
  if (!s.enableRp) return 0;
  const t = dec(total);
  if (dec(s.minOrderTotalForRp).gt(t)) return 0;
  const per = dec(s.amountForUnitRp);
  if (per.lte(0)) return 0;
  let points = t.div(per).floor().toNumber();
  if (s.maxRpPerOrder && s.maxRpPerOrder < points) points = s.maxRpPerOrder;
  return points;
}

/**
 * True when the reward points of a sale have expired. Laravel's `isRewardExpired` compares the wrong way round (it reports
 * "expired" while the points are still valid); this uses the intended meaning: the points of a sale expire
 * `rp_expiry_period` months/years after the sale date.
 */
export function rewardExpired(saleDate: Date, now: Date, s: Pick<RewardSettings, 'rpExpiryPeriod' | 'rpExpiryType'>): boolean {
  if (!s.rpExpiryPeriod) return false;
  const d = new Date(saleDate.getTime());
  if (s.rpExpiryType === 'month') d.setUTCMonth(d.getUTCMonth() + s.rpExpiryPeriod);
  else if (s.rpExpiryType === 'year') d.setUTCFullYear(d.getUTCFullYear() + s.rpExpiryPeriod);
  else return false;
  return d.getTime() < now.getTime();
}

export interface RewardAdjustment {
  /** New value of the sale's `rp_earned`. */
  saleRpEarned: number;
  /** Change of the customer's `total_rp` (0 for the walk-in customer). */
  customerDelta: number;
}

/**
 * `addSellReturn`: points are earned on (sale total - return total). Returns null when nothing changes
 * (reward points off, sale earned none, or the points already expired).
 */
export function rewardAdjustmentForReturn(input: {
  settings: RewardSettings;
  saleFinalTotal: Decimalish;
  returnFinalTotal: Decimalish;
  saleRpEarned: number;
  saleDate: Date;
  now: Date;
  customerIsDefault: boolean;
}): RewardAdjustment | null {
  if (!input.settings.enableRp || !input.saleRpEarned) return null;
  if (rewardExpired(input.saleDate, input.now, input.settings)) return null;
  const diff = dec(input.saleFinalTotal).sub(dec(input.returnFinalTotal));
  const earned = calculateRewardPoints(input.settings, diff);
  return { saleRpEarned: earned, customerDelta: input.customerIsDefault ? 0 : earned - input.saleRpEarned };
}

// ------------------------------------------------------------------------------------------------ misc

/** `[a-z0-9_]` payment method keys (cash, card, cheque, bank_transfer, other, custom_pay_1..7, advance). */
export const PAYMENT_METHOD_PATTERN = /^[a-z0-9_]{1,50}$/;

/** Only a sale that is final and of type `sell` can be returned. */
export function assertReturnableSale(sale: { type: string | null; status: string }): void {
  if (sale.type !== 'sell' || sale.status !== 'final') throw new BadRequestException('Only a completed sale can be returned');
}

export function assertLocationPermitted(permitted: 'all' | readonly number[], locationId: number | null): void {
  if (permitted === 'all') return;
  if (locationId === null || !permitted.includes(locationId)) throw new ForbiddenException('You do not have access to the location of this sale');
}

/**
 * Laravel filters `whereDate(transaction_date) between start and end` in the business time zone. Gives the matching
 * half-open range of real instants: [00:00 of start, 00:00 of the day after end). Either side may be missing.
 */
export function dayRange(startDate: string | undefined, endDate: string | undefined, timeZone: string): { gte?: Date; lt?: Date } {
  const out: { gte?: Date; lt?: Date } = {};
  if (startDate) out.gte = wallClockToInstant(new Date(`${startDate}T00:00:00.000Z`), timeZone);
  if (endDate) {
    const next = new Date(`${endDate}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    out.lt = wallClockToInstant(next, timeZone);
  }
  if (out.gte && out.lt && out.gte >= out.lt) throw new BadRequestException('The end date cannot be before the start date');
  return out;
}

/** Plain decimal text for JSON (never exponent notation). */
export const str = (v: Decimalish): string => dec(v).toFixed();
