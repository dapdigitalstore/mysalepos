/**
 * Live totals of a sale, the same formulas as the API (apps/api/src/modules/sales/sale.rules.ts, docs/SALES-API.md section 3.1):
 *
 *   discounted      = fixed ? price - discount : percentage ? price * (100 - discount) / 100 : price
 *   unitPriceIncTax = round(discounted + discounted * lineTaxRate / 100, cp)
 *   itemTax         = round(discounted * lineTaxRate / 100, cp)          (unrounded price inc tax - discounted)
 *   lineTotal       = quantity * unitPriceIncTax
 *   totalBeforeTax  = sum(lineTotal)
 *   discount        = fixed ? amount : amount / 100 * totalBeforeTax
 *   tax             = orderTaxRate / 100 * (totalBeforeTax - discount)
 *   payable         = totalBeforeTax + tax - discount + shipping + sum(additional expenses)
 *   finalTotal      = round(payable rounded to the rounding multiple, cp)
 *
 * Strings in, strings out; nothing here uses floating point. The server recomputes everything when the sale is saved.
 */
import { add, cmp, dec, div100, HUNDRED, isPos, isZero, max, mul, round, sub, sum, toFixed, toNearest, ZERO, type Dec } from './decimal';

export type DiscountType = 'fixed' | 'percentage';

export interface LineMathInput {
  quantity: string;
  /** Price excluding tax, before the discount, per the unit being sold. */
  unitPrice: string;
  discountType: DiscountType;
  discountAmount: string;
  /** Percent of the line tax ("10"), or "" / "0" for none. */
  taxRate: string;
}

export interface LineMath {
  discounted: Dec;
  unitPriceIncTax: Dec;
  itemTax: Dec;
  lineTotal: Dec;
}

export function discountedPrice(unitPrice: Dec, type: DiscountType, amount: Dec): Dec {
  if (isZero(amount)) return unitPrice;
  if (type === 'fixed') return sub(unitPrice, amount);
  return div100(mul(unitPrice, sub(HUNDRED, amount)));
}

export function calcLine(input: LineMathInput, currencyPrecision: number): LineMath {
  const quantity = dec(input.quantity);
  const discounted = discountedPrice(dec(input.unitPrice), input.discountType, dec(input.discountAmount));
  const tax = div100(mul(discounted, dec(input.taxRate)));
  const unitPriceIncTax = round(add(discounted, tax), currencyPrecision);
  const itemTax = round(tax, currencyPrecision);
  return { discounted, unitPriceIncTax, itemTax, lineTotal: mul(quantity, unitPriceIncTax) };
}

export interface InvoiceMathInput {
  lineTotals: Dec[];
  discountType: DiscountType;
  discountAmount: string;
  /** Percent of the order tax. */
  taxRate: string;
  shippingCharges: string;
  additionalExpenses: string[];
  /** posSettings.amount_rounding_method ("0.05", "1", ...), null / "" / "0" for none. */
  roundingMultiple: string | null;
  currencyPrecision: number;
}

export interface InvoiceMath {
  totalBeforeTax: Dec;
  discount: Dec;
  tax: Dec;
  shipping: Dec;
  additional: Dec;
  payable: Dec;
  roundOff: Dec;
  finalTotal: Dec;
}

export function calcInvoice(input: InvoiceMathInput): InvoiceMath {
  const totalBeforeTax = sum(input.lineTotals);
  const amount = dec(input.discountAmount);
  const discount = isZero(amount) ? ZERO : input.discountType === 'fixed' ? amount : mul(div100(amount), totalBeforeTax);
  const rate = dec(input.taxRate);
  const tax = isZero(rate) ? ZERO : mul(div100(rate), sub(totalBeforeTax, discount));
  const shipping = dec(input.shippingCharges);
  const additional = sum(input.additionalExpenses.map(dec));
  const payable = sub(add(add(add(totalBeforeTax, tax), shipping), additional), discount);
  const multiple = dec(input.roundingMultiple);
  const rounded = isPos(multiple) ? toNearest(payable, multiple) : payable;
  return {
    totalBeforeTax,
    discount,
    tax,
    shipping,
    additional,
    payable,
    roundOff: sub(rounded, payable),
    finalTotal: round(rounded, input.currencyPrecision),
  };
}

// ---------------------------------------------------------------------------------------------- payments

export type PaymentStatus = 'paid' | 'partial' | 'due';

export interface PaymentSummary {
  /** What the customer hands over (sum of the payment rows). */
  tendered: Dec;
  /** Still to pay (0 when fully paid). */
  balance: Dec;
  /** Cash to give back: tendered above the total. Sent as `changeReturn`. */
  change: Dec;
  /** Status the sale will have: totalPaid = tendered - change. */
  status: PaymentStatus;
}

export function summarizePayments(finalTotal: Dec, amounts: string[]): PaymentSummary {
  const tendered = sum(amounts.map(dec));
  const balance = max(sub(finalTotal, tendered), ZERO);
  const change = max(sub(tendered, finalTotal), ZERO);
  const paid = sub(tendered, change);
  const status: PaymentStatus = cmp(finalTotal, paid) <= 0 ? 'paid' : isPos(paid) ? 'partial' : 'due';
  return { tendered, balance, change, status };
}

/** Amount that is still missing when the row at `index` is topped up ("exact amount" button). Never negative. */
export function remainingForRow(finalTotal: Dec, amounts: string[], index: number): Dec {
  const others = sum(amounts.filter((_, i) => i !== index).map(dec));
  return max(sub(finalTotal, others), ZERO);
}

/** Round-up amounts above the total for the quick cash buttons (e.g. 1,240 -> 1,250, 1,500, 2,000). At most three. */
export function cashSuggestions(total: Dec): Dec[] {
  if (!isPos(total)) return [];
  const rounded = round(total, 0);
  const whole = BigInt(toFixed(cmp(rounded, total) >= 0 ? rounded : add(rounded, { n: 1n, s: 0 }), 0));
  const out: Dec[] = [];
  for (const step of [50n, 100n, 500n, 1000n, 5000n]) {
    // the smallest multiple of `step` above the total (the exact total has its own button)
    const candidate: Dec = { n: ((whole + step - 1n) / step) * step, s: 0 };
    if (cmp(candidate, total) > 0 && !out.some((o) => cmp(o, candidate) === 0)) out.push(candidate);
    if (out.length >= 3) break;
  }
  return out;
}
