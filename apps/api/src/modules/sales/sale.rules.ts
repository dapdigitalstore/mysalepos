import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../common/can';
import type { AuthUser } from '../../common/types';

/**
 * Pure business rules of a sale (no database, no Nest services), ported from Laravel:
 * `ProductUtil::calculateInvoiceTotal`, `public/js/pos.js` (pos_each_row, calculate_billing_details), `TransactionUtil`
 * (createOrUpdateSellLines, calculatePaymentStatus, getInvoiceNumber, calculateRewardPoints, isCustomerCreditLimitExeeded, ...).
 * Everything is Prisma.Decimal, never floating point.
 */

export type Num = string | number | Prisma.Decimal | null | undefined;
export type DiscountType = 'fixed' | 'percentage';
export type PaymentStatus = 'paid' | 'due' | 'partial';

export const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** True when the caller really supplied a value (0 counts as supplied, '' and null do not). */
export function isGiven(v: Num): boolean {
  return v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
}

/** Parses an amount. Missing -> 0. Throws a 400 on anything that is not a finite number. */
export function dec(v: Num): Prisma.Decimal {
  if (!isGiven(v)) return ZERO;
  try {
    const d = new Prisma.Decimal(typeof v === 'string' ? v.trim() : (v as string | number | Prisma.Decimal));
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new BadRequestException(`"${String(v)}" is not a valid number`);
  }
}

/** Rounds half up to `places` decimals (Laravel number_format / JS toFixed behaviour for positive values). */
export function roundTo(d: Prisma.Decimal, places: number): Prisma.Decimal {
  return d.toDecimalPlaces(places, HALF_UP);
}

/** The 4 decimals every money / quantity column of the database keeps. */
export const round4 = (d: Prisma.Decimal): Prisma.Decimal => roundTo(d, 4);

// ------------------------------------------------------------------------------------------------ status

export type SaleStatusInput = 'final' | 'draft' | 'quotation' | 'proforma';

export interface ResolvedStatus {
  status: 'final' | 'draft';
  isQuotation: boolean;
  subStatus: 'quotation' | 'proforma' | null;
}

/** Laravel store()/update(): `quotation` and `proforma` are drafts with a sub status. */
export function resolveStatus(input: SaleStatusInput): ResolvedStatus {
  if (input === 'quotation') return { status: 'draft', isQuotation: true, subStatus: 'quotation' };
  if (input === 'proforma') return { status: 'draft', isQuotation: false, subStatus: 'proforma' };
  return { status: input, isQuotation: false, subStatus: null };
}

// ------------------------------------------------------------------------------------------------ lines

export interface LineInput {
  quantity: Num;
  /** Unit price excluding tax, before the line discount, in the unit the cashier picked (sub-unit price when sub_unit is used). */
  unitPrice: Num;
  discountType?: DiscountType | null;
  discountAmount?: Num;
  /** Tax rate in percent (tax_rates.amount), null/undefined when the line has no tax. */
  taxRate?: Num;
  /** base_unit_multiplier of the chosen sub-unit; 1 for the product's own unit. */
  multiplier?: Num;
}

export interface LineResult {
  /** What the screen shows (per selected unit). */
  unitPriceBeforeDiscount: Prisma.Decimal;
  discountedUnitPrice: Prisma.Decimal;
  unitPriceIncTax: Prisma.Decimal;
  itemTax: Prisma.Decimal;
  /** quantity x unitPriceIncTax, the number that goes into the invoice sub total. */
  lineTotal: Prisma.Decimal;
  /** What `transaction_sell_lines` stores (per base unit, quantity in base units). */
  stored: {
    quantity: Prisma.Decimal;
    unit_price_before_discount: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    line_discount_type: DiscountType | null;
    line_discount_amount: Prisma.Decimal;
    item_tax: Prisma.Decimal;
    unit_price_inc_tax: Prisma.Decimal;
  };
}

/** Unit price after the line discount (pos.js calculate_discounted_unit_price). */
export function discountedUnitPrice(unitPrice: Prisma.Decimal, type: DiscountType | null | undefined, amount: Prisma.Decimal): Prisma.Decimal {
  if (!type || amount.isZero()) return unitPrice;
  if (type === 'fixed') return unitPrice.sub(amount);
  return unitPrice.mul(HUNDRED.sub(amount)).div(HUNDRED);
}

/**
 * One sell line, exactly like pos.js `pos_each_row` + `createOrUpdateSellLines`:
 *  unit_price_inc_tax = discounted + discounted x rate% (shown with `precision` decimals), item_tax = difference,
 *  then everything is divided by the sub-unit multiplier for storage.
 */
export function calculateLine(input: LineInput, precision: number): LineResult {
  const quantity = dec(input.quantity);
  const multiplier = isGiven(input.multiplier) && !dec(input.multiplier).isZero() ? dec(input.multiplier) : new Prisma.Decimal(1);
  const unitPrice = dec(input.unitPrice);
  const type = input.discountType ?? null;
  const discountAmount = dec(input.discountAmount);
  const rate = dec(input.taxRate);

  const discounted = discountedUnitPrice(unitPrice, type, discountAmount);
  const incTaxExact = discounted.add(discounted.mul(rate).div(HUNDRED));
  const unitPriceIncTax = roundTo(incTaxExact, precision);
  const itemTax = roundTo(incTaxExact.sub(discounted), precision);

  // Stored per base unit (createOrUpdateSellLines divides by the multiplier).
  const upbd = unitPrice.div(multiplier);
  let storedUnitPrice = upbd;
  if (type && !discountAmount.isZero()) {
    storedUnitPrice = type === 'fixed' ? upbd.sub(discountAmount.div(multiplier)) : HUNDRED.sub(discountAmount).mul(upbd).div(HUNDRED);
  }
  const storedDiscount = discountAmount.isZero() ? ZERO : type === 'fixed' ? discountAmount.div(multiplier) : discountAmount;

  return {
    unitPriceBeforeDiscount: unitPrice,
    discountedUnitPrice: discounted,
    unitPriceIncTax,
    itemTax,
    lineTotal: quantity.mul(unitPriceIncTax),
    stored: {
      quantity: round4(quantity.mul(multiplier)),
      unit_price_before_discount: round4(upbd),
      unit_price: round4(storedUnitPrice),
      line_discount_type: type,
      line_discount_amount: round4(storedDiscount),
      item_tax: round4(itemTax.div(multiplier)),
      unit_price_inc_tax: round4(unitPriceIncTax.div(multiplier)),
    },
  };
}

// ------------------------------------------------------------------------------------------------ invoice totals

export interface InvoiceInput {
  /** Per line: quantity x unit_price_inc_tax (the number calculateLine returns as lineTotal). */
  lineTotals: Prisma.Decimal[];
  discountType?: DiscountType | null;
  discountAmount?: Num;
  /** Order tax rate in percent (tax_rates.amount of the chosen tax), null when none. */
  taxRate?: Num;
  shippingCharges?: Num;
  additionalExpenses?: Num[];
  /** Packing charge of a type of service: amount (fixed) or percent of the sub total. */
  packingCharge?: Num;
  packingChargeType?: 'fixed' | 'percent' | null;
  /** Value of reward points redeemed; Laravel adds it to the discount before tax. */
  rpRedeemedAmount?: Num;
  /** pos_settings.amount_rounding_method (e.g. 0.05, 1, 5, 10); 0/null = no rounding. */
  roundingMultiple?: Num;
  /** business.currency_precision */
  precision: number;
}

export interface InvoiceTotals {
  totalBeforeTax: Prisma.Decimal;
  /** The money value of the invoice discount (not the percent), excluding reward points. */
  discountValue: Prisma.Decimal;
  rpRedeemedAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  shippingCharges: Prisma.Decimal;
  packingChargeValue: Prisma.Decimal;
  additionalExpenseTotal: Prisma.Decimal;
  /** Total before the rounding rule. */
  totalPayable: Prisma.Decimal;
  roundOffAmount: Prisma.Decimal;
  finalTotal: Prisma.Decimal;
}

/**
 * Invoice totals, the maths of `ProductUtil::calculateInvoiceTotal` plus pos.js `calculate_billing_details`:
 *   total_before_tax = sum(qty x unit_price_inc_tax)           (so it already contains the per line tax)
 *   discount         = fixed ? amount : amount% x total_before_tax
 *   tax              = order tax rate% x (total_before_tax - discount - redeemed reward amount)
 *   total            = total_before_tax + tax - discount - redeemed + shipping + packing + additional expenses
 *   final_total      = total rounded to the rounding multiple, then to the currency precision.
 */
export function calculateInvoiceTotals(input: InvoiceInput): InvoiceTotals {
  const totalBeforeTax = input.lineTotals.reduce((a, b) => a.add(b), ZERO);
  const amount = dec(input.discountAmount);
  let discountValue = ZERO;
  if (input.discountType === 'fixed') discountValue = amount;
  else if (input.discountType === 'percentage') discountValue = amount.div(HUNDRED).mul(totalBeforeTax);

  const rp = dec(input.rpRedeemedAmount);
  const taxable = totalBeforeTax.sub(discountValue).sub(rp);
  const rate = dec(input.taxRate);
  const taxAmount = rate.isZero() ? ZERO : rate.div(HUNDRED).mul(taxable);

  const shipping = dec(input.shippingCharges);
  let packing = ZERO;
  if (input.packingChargeType === 'fixed') packing = dec(input.packingCharge);
  else if (input.packingChargeType === 'percent') packing = dec(input.packingCharge).div(HUNDRED).mul(totalBeforeTax);
  const additional = (input.additionalExpenses ?? []).reduce<Prisma.Decimal>((a, b) => a.add(dec(b)), ZERO);

  const totalPayable = totalBeforeTax.add(taxAmount).sub(discountValue).sub(rp).add(shipping).add(packing).add(additional);

  const multiple = dec(input.roundingMultiple);
  const rounded = multiple.gt(0) ? totalPayable.toNearest(multiple, HALF_UP) : totalPayable;
  const roundOffAmount = rounded.sub(totalPayable);

  return {
    totalBeforeTax: round4(totalBeforeTax),
    discountValue,
    rpRedeemedAmount: rp,
    taxAmount: round4(taxAmount),
    shippingCharges: shipping,
    packingChargeValue: packing,
    additionalExpenseTotal: additional,
    totalPayable,
    roundOffAmount: round4(roundOffAmount),
    finalTotal: roundTo(rounded, input.precision),
  };
}

// ------------------------------------------------------------------------------------------------ payments

export interface PaymentAmountRow {
  amount: Num;
  isReturn?: boolean | number | null;
}

/** SUM(IF(is_return = 0, amount, -amount)) of `TransactionUtil::getTotalPaid`. */
export function totalPaid(payments: PaymentAmountRow[]): Prisma.Decimal {
  return payments.reduce<Prisma.Decimal>((sum, p) => (p.isReturn ? sum.sub(dec(p.amount)) : sum.add(dec(p.amount))), ZERO);
}

/** `TransactionUtil::calculatePaymentStatus`. */
export function paymentStatus(finalTotal: Num, paid: Num): PaymentStatus {
  const total = dec(finalTotal);
  const p = dec(paid);
  if (total.lte(p)) return 'paid';
  if (p.gt(0) && total.gt(p)) return 'partial';
  return 'due';
}

/** Payment status shown in lists: due / partial turn into overdue / partial-overdue once the pay term has passed (Transaction::getPaymentStatus). */
export function displayPaymentStatus(
  status: string | null,
  payTermNumber: number | null | undefined,
  payTermType: string | null | undefined,
  transactionDate: Date,
  now: Date,
): string | null {
  if ((status === 'due' || status === 'partial') && payTermNumber && payTermType) {
    const due = new Date(transactionDate.getTime());
    if (payTermType === 'days') due.setUTCDate(due.getUTCDate() + payTermNumber);
    else due.setUTCMonth(due.getUTCMonth() + payTermNumber);
    if (now.getTime() > due.getTime()) return status === 'due' ? 'overdue' : 'partial-overdue';
  }
  return status;
}

export interface PaymentInputRow {
  id?: number;
  method: string;
  amount: Num;
  isReturn?: boolean;
  transactionNo?: string | null;
}

export const CUSTOM_PAY_METHOD = /^custom_pay_[1-7]$/;

/**
 * Drops payment rows with amount 0 (createOrUpdatePaymentLines "If amount is 0 then skip") and validates the rest.
 * Existing payments (`id` given) are kept even at 0 so an edit can zero them out like Laravel's editPaymentLine.
 * Advance payments may not exceed the customer's advance balance (summed over all advance rows).
 */
export function normalizePaymentRows<T extends PaymentInputRow>(rows: T[], advanceBalance: Num): T[] {
  const kept = rows.filter((r) => r.id !== undefined || !dec(r.amount).isZero());
  let advance = ZERO;
  for (const r of kept) {
    if (!r.method || !r.method.trim()) throw new BadRequestException('Payment method is required');
    if (dec(r.amount).isNegative()) throw new BadRequestException('Payment amount cannot be negative');
    if (r.method === 'advance' && r.id === undefined && !r.isReturn) advance = advance.add(dec(r.amount));
  }
  if (advance.gt(dec(advanceBalance))) {
    throw new BadRequestException({ message: 'The required advance balance is not available', code: 'ADVANCE_BALANCE_NOT_AVAILABLE' });
  }
  return kept;
}

/** `AccountTransaction::getAccountTransactionType` for a sale payment; a change given back is a debit. */
export function accountTransactionType(isReturn: boolean): 'credit' | 'debit' {
  return isReturn ? 'debit' : 'credit';
}

// ------------------------------------------------------------------------------------------------ credit limit

export interface CreditLimitInput {
  status: 'final' | 'draft';
  finalTotal: Num;
  /** Sum of the payments sent with this sale (0 for a credit sale: payments are ignored then). */
  currentPayments: Num;
  creditLimit: Num | undefined;
  /** Sum of final_total of the customer's other final sell invoices. */
  otherInvoiceTotal: Num;
  /** Net payments (returns subtracted) on those other invoices. */
  otherInvoicePaid: Num;
}

/** `isCustomerCreditLimitExeeded`: returns the limit when it would be exceeded, otherwise false. A null limit means unlimited; 0 is a real limit. */
export function creditLimitExceeded(i: CreditLimitInput): Prisma.Decimal | false {
  if (i.status === 'draft') return false;
  const finalTotal = dec(i.finalTotal);
  const paying = dec(i.currentPayments);
  if (finalTotal.lte(paying)) return false;
  if (i.creditLimit === null || i.creditLimit === undefined) return false;
  const limit = dec(i.creditLimit);
  const currentDue = finalTotal.sub(paying);
  const totalDue = dec(i.otherInvoiceTotal).sub(dec(i.otherInvoicePaid)).add(currentDue);
  return totalDue.lte(limit) ? false : limit;
}

// ------------------------------------------------------------------------------------------------ reward points

export interface RewardSettings {
  enableRp: boolean;
  minOrderTotalForRp: Num;
  amountForUnitRp: Num;
  maxRpPerOrder: number | null;
}

/** `calculateRewardPoints`: points earned by an order total. */
export function rewardPointsEarned(total: Num, s: RewardSettings): number {
  if (!s.enableRp) return 0;
  const t = dec(total);
  if (dec(s.minOrderTotalForRp).gt(t)) return 0;
  const unit = dec(s.amountForUnitRp);
  if (unit.lte(0)) return 0;
  let points = t.div(unit).floor().toNumber();
  if (s.maxRpPerOrder && s.maxRpPerOrder < points) points = s.maxRpPerOrder;
  return points;
}

/** `updateCustomerRewardPoints`: change of total_rp and total_rp_used after a sale is created / edited / deleted. */
export function rewardPointsChange(earned: number, earnedBefore: number, redeemed: number, redeemedBefore: number): { totalRpDelta: number; usedDelta: number } {
  const totalRedeemed = redeemed - redeemedBefore;
  return { totalRpDelta: earned - earnedBefore - totalRedeemed, usedDelta: totalRedeemed };
}

// ------------------------------------------------------------------------------------------------ invoice numbers

export interface InvoiceSchemeRow {
  scheme_type: 'blank' | 'year';
  number_type: string;
  prefix: string | null;
  start_number: number | null;
  invoice_count: number;
  total_digits: number | null;
}

/**
 * `getInvoiceNumber` for a final sale: prefix (+ year + "-" for year schemes) + zero padded counter.
 * Sequential schemes use start_number + invoice_count; random schemes draw a number with `total_digits` digits.
 */
export function formatInvoiceNumber(s: InvoiceSchemeRow, year: number, random: () => number = Math.random): string {
  const digits = s.total_digits ?? 0;
  const prefix = s.scheme_type === 'blank' ? (s.prefix ?? '') : `${s.prefix ?? ''}${year}-`;
  let count: number;
  if (s.number_type === 'random') {
    const max = Number('1'.repeat(Math.max(1, digits)));
    count = 1000 + Math.floor(random() * (9 * max - 1000 + 1));
  } else {
    count = (s.start_number ?? 0) + s.invoice_count;
  }
  return prefix + String(count).padStart(digits, '0');
}

// ------------------------------------------------------------------------------------------------ editing rules

/** `canBeEdited`: a sale can be edited until `transaction_edit_days` after its date (midnight of today as the limit). */
export function canBeEdited(transactionDate: Date, editDays: number, startOfToday: Date): boolean {
  return transactionDate.getTime() + editDays * 86_400_000 >= startOfToday.getTime();
}

// ------------------------------------------------------------------------------------------------ combo products

export interface ComboComponent {
  productId: number;
  variationId: number;
  /** Total component quantity for this sale line (qty required per combo x combos sold). */
  quantity: Prisma.Decimal;
  /** The component's current variations.sell_price_inc_tax. */
  sellPriceIncTax: Prisma.Decimal;
}

export interface ComboChildLine {
  productId: number;
  variationId: number;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
}

/**
 * `__makeLinesForComboProduct`: the component lines share the combo's selling price, so each component price is
 * moved by the same percentage that turns the sum of component prices into the combo line total.
 */
export function comboChildLines(components: ComboComponent[], parentUnitPriceIncTax: Prisma.Decimal, parentQuantity: Prisma.Decimal): ComboChildLine[] {
  const comboTotal = components.reduce((a, c) => a.add(c.quantity.mul(c.sellPriceIncTax)), ZERO);
  const parentTotal = parentUnitPriceIncTax.mul(parentQuantity);
  const changePercent = comboTotal.isZero() ? ZERO : parentTotal.sub(comboTotal).div(comboTotal).mul(HUNDRED);
  return components.map((c) => ({
    productId: c.productId,
    variationId: c.variationId,
    quantity: c.quantity,
    unitPrice: round4(c.sellPriceIncTax.add(c.sellPriceIncTax.mul(changePercent).div(HUNDRED))),
  }));
}

// ------------------------------------------------------------------------------------------------ prices and permissions

/** Group price of a variation (`getVariationGroupPrice`): fixed amount, or a percentage of the normal inc-tax price. Returns inc / exc tax. */
export function groupPriceFor(
  priceType: string | null | undefined,
  groupValue: Num,
  sellPriceIncTax: Num,
  taxRate: Num,
): { incTax: Prisma.Decimal; excTax: Prisma.Decimal } {
  const incTax = priceType === 'percentage' ? dec(sellPriceIncTax).mul(dec(groupValue)).div(HUNDRED) : dec(groupValue);
  const rate = dec(taxRate);
  const excTax = incTax.isZero() || rate.isZero() ? incTax : incTax.mul(HUNDRED).div(HUNDRED.add(rate));
  return { incTax, excTax };
}

/** Customer group "percentage" price calculation: both catalogue prices move by the group percent (getProductRow). */
export function customerGroupPrice(price: Num, percent: Num): Prisma.Decimal {
  const p = dec(price);
  return p.add(dec(percent).mul(p).div(HUNDRED));
}

/**
 * The catalogue unit price (excluding tax, per base unit) a screen starts with: the selling price group price when
 * it exists, else the variation default price, moved by the customer group percentage.
 */
export function expectedUnitPriceExcTax(defaultSellPrice: Num, groupExcTax: Prisma.Decimal | null, customerGroupPercent: Num): Prisma.Decimal {
  const base = groupExcTax && !groupExcTax.isZero() ? groupExcTax : dec(defaultSellPrice);
  return customerGroupPrice(base, customerGroupPercent);
}

/**
 * True when the cashier may use this price: allowed to edit prices, or the price is the catalogue price. The screens show
 * prices with the currency precision, so that is the precision the two are compared at.
 */
export function priceChangeAllowed(canEditPrice: boolean, sentPrice: Prisma.Decimal, expectedPrice: Prisma.Decimal, precision = 2): boolean {
  return canEditPrice || roundTo(sentPrice, precision).eq(roundTo(expectedPrice, precision));
}

export type SaleScreen = 'pos' | 'direct';

/** Permission names that unlock editing a line price / line discount on each screen. */
export function linePermissions(screen: SaleScreen): { price: string; discount: string } {
  return screen === 'direct'
    ? { price: 'edit_product_price_from_sale_screen', discount: 'edit_product_discount_from_sale_screen' }
    : { price: 'edit_product_price_from_pos_screen', discount: 'edit_product_discount_from_pos_screen' };
}

// ------------------------------------------------------------------------------------------------ visibility

export interface SaleVisibility {
  /** null = every location, otherwise only these location ids. */
  locationIds: number[] | null;
  /** Restrict to sales created by the user. */
  ownOnly: boolean;
  /** Also include sales where the user is the commission agent (when ownOnly or on its own). */
  commissionAgentOnly: boolean;
}

/** Locations the user may see: `null` = all (`permitted_locations() == 'all'`), otherwise the `location.<id>` permissions. */
export function permittedLocations(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>): number[] | null {
  if (can(user, 'access_all_locations')) return null;
  return user.permissions
    .filter((p) => p.startsWith('location.'))
    .map((p) => Number(p.slice('location.'.length)))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * SellController@index scoping: users without `direct_sell.view` see only their own sales when they hold
 * view_own_sell_only / access_own_shipping, plus the ones they are commission agent of when they hold
 * view_commission_agent_sell / access_commission_agent_shipping. A user holding none of these sees everything.
 */
export function saleVisibility(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>): SaleVisibility {
  const locationIds = permittedLocations(user);
  if (can(user, 'direct_sell.view')) return { locationIds, ownOnly: false, commissionAgentOnly: false };
  const own = can(user, 'view_own_sell_only') || can(user, 'access_own_shipping');
  const agent = can(user, 'view_commission_agent_sell') || can(user, 'access_commission_agent_shipping');
  // Admins hold every permission via can(), so they would be limited to "own"; they must see everything.
  if (user.isAdmin || user.isSuperadmin) return { locationIds, ownOnly: false, commissionAgentOnly: false };
  return { locationIds, ownOnly: own, commissionAgentOnly: agent };
}

/** SellController@show: users who only hold view_own_sell_only (no sell.view, no direct_sell.access) are limited to their own sales. */
export function showOwnOnly(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>): boolean {
  if (user.isAdmin || user.isSuperadmin) return false;
  return !can(user, 'sell.view') && !can(user, 'direct_sell.access') && can(user, 'view_own_sell_only');
}

// ------------------------------------------------------------------------------------------------ POS settings

/** `BusinessUtil::defaultPosSettings`. */
export const DEFAULT_POS_SETTINGS: Record<string, unknown> = {
  disable_pay_checkout: 0,
  disable_draft: 0,
  disable_express_checkout: 0,
  hide_product_suggestion: 0,
  hide_recent_trans: 0,
  disable_discount: 0,
  disable_order_tax: 0,
  is_pos_subtotal_editable: 0,
};

/** business.pos_settings is a JSON text; empty means the defaults. */
export function parsePosSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return { ...DEFAULT_POS_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through to the defaults */
  }
  return { ...DEFAULT_POS_SETTINGS };
}

export function posFlag(settings: Record<string, unknown>, key: string): boolean {
  const v = settings[key];
  return v === true || v === 1 || v === '1';
}

/** business.enabled_modules is a JSON array text. */
export function parseEnabledModules(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** Rounding multiple of pos_settings.amount_rounding_method (null / "" / "none" = none). */
export function roundingMultipleOf(settings: Record<string, unknown>): Prisma.Decimal {
  const v = settings.amount_rounding_method;
  if (v === null || v === undefined || v === '' || v === 'none') return ZERO;
  try {
    const d = new Prisma.Decimal(v as string | number);
    return d.isFinite() && d.gt(0) ? d : ZERO;
  } catch {
    return ZERO;
  }
}

// ------------------------------------------------------------------------------------------------ misc

/** Unit multiplier: the sub-unit's base_unit_multiplier, or 1 when the sale unit is the product's own unit. */
export function unitMultiplier(productUnitId: number | null, saleUnitId: number | null | undefined, subUnitMultiplier: Num): Prisma.Decimal {
  if (!saleUnitId || saleUnitId === productUnitId) return new Prisma.Decimal(1);
  const m = dec(subUnitMultiplier);
  return m.gt(0) ? m : new Prisma.Decimal(1);
}

/** True when `quantity` has no fractional part. */
export function isWholeNumber(quantity: Prisma.Decimal): boolean {
  return quantity.eq(quantity.floor());
}

/** An optional text column: blank strings become null. */
export function textOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

// ------------------------------------------------------------------------------------------------ stored JSON, payment methods

/** products.sub_unit_ids is JSON text like `["12","13"]`; empty means every sub-unit is allowed. */
export function parseIdList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

export interface ComboComponentDef {
  variationId: number;
  /** Quantity of the component needed for ONE combo, in the component's `unitId`. */
  quantity: Prisma.Decimal;
  unitId: number | null;
}

/** variations.combo_variations is JSON text, `[]` for products that are not combos. */
export function parseComboComponents(raw: string | null | undefined): ComboComponentDef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ComboComponentDef[] = [];
    for (const row of parsed as Record<string, unknown>[]) {
      const variationId = Number(row.variation_id);
      if (!Number.isInteger(variationId) || variationId <= 0) continue;
      const unit = Number(row.unit_id);
      out.push({ variationId, quantity: dec(String(row.quantity ?? 0)), unitId: Number.isInteger(unit) && unit > 0 ? unit : null });
    }
    return out;
  } catch {
    return [];
  }
}

/** Payment methods a sale payment may use (Util::payment_types plus `advance`). */
export const PAYMENT_METHODS = ['cash', 'card', 'cheque', 'bank_transfer', 'other', 'advance'] as const;

export function isKnownPaymentMethod(method: string): boolean {
  return (PAYMENT_METHODS as readonly string[]).includes(method) || CUSTOM_PAY_METHOD.test(method);
}

/** True when any shipping field is filled (these need the access_shipping permission). */
export function hasShippingData(d: {
  shippingCharges?: Num;
  shippingDetails?: string | null;
  shippingAddress?: string | null;
  shippingStatus?: string | null;
  deliveredTo?: string | null;
  deliveryPerson?: number | null;
}): boolean {
  return (
    !dec(d.shippingCharges).isZero() ||
    !!textOrNull(d.shippingDetails) ||
    !!textOrNull(d.shippingAddress) ||
    !!textOrNull(d.shippingStatus) ||
    !!textOrNull(d.deliveredTo) ||
    !!d.deliveryPerson
  );
}

/**
 * A payment can only be added to a sale that still has a balance, and never for more than that balance
 * (the payment dialog of Laravel limits the amount to the due amount; advance and other methods alike).
 */
export function assertPayable(finalTotal: Num, paid: Num, amount: Num): void {
  const due = dec(finalTotal).sub(dec(paid));
  if (due.lte(0)) throw new BadRequestException({ message: 'This sale is already fully paid', code: 'ALREADY_PAID' });
  if (dec(amount).gt(due)) throw new BadRequestException({ message: `The payment cannot be more than the due amount (${due.toFixed()})`, code: 'PAYMENT_EXCEEDS_DUE' });
}
