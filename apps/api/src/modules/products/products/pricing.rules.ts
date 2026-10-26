import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Price maths of a product variation, ported from Laravel (`public/js/product.js` + `ProductUtil`).
 * Everything uses Prisma.Decimal; nothing here touches floating point. Amounts are stored with 4 decimals.
 */

export type Decimalish = string | number | Prisma.Decimal | null | undefined;
export type TaxType = 'inclusive' | 'exclusive';

const HUNDRED = new Prisma.Decimal(100);
const ZERO = new Prisma.Decimal(0);

/** True when the caller really supplied a value (0 counts as supplied, '' and null do not). */
export function isGiven(v: Decimalish): boolean {
  return v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
}

/** Parses a user supplied amount. Missing -> 0. Throws on anything that is not a finite number. */
export function toDecimal(v: Decimalish): Prisma.Decimal {
  if (!isGiven(v)) return ZERO;
  try {
    const d = new Prisma.Decimal(typeof v === 'string' ? v.trim() : (v as string | number | Prisma.Decimal));
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw new BadRequestException(`"${String(v)}" is not a valid number`);
  }
}

/** Rounds to the 4 decimals the database keeps (half up, like Laravel's number_format). */
export function round4(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** amount + percentage% of amount (`__add_percent`). */
export function addPercent(amount: Prisma.Decimal, percent: Prisma.Decimal): Prisma.Decimal {
  return amount.add(amount.mul(percent).div(HUNDRED));
}

/** The amount before tax for an amount that already includes `percent`% tax (`__get_principle`). */
export function principleOf(amountInclTax: Prisma.Decimal, percent: Prisma.Decimal): Prisma.Decimal {
  return amountInclTax.mul(HUNDRED).div(HUNDRED.add(percent));
}

/** Profit percent of `amount` over `principal` (`__get_rate`). Zero when there is no principal. */
export function ratePercent(principal: Prisma.Decimal, amount: Prisma.Decimal): Prisma.Decimal {
  if (principal.isZero()) return ZERO;
  return amount.sub(principal).div(principal).mul(HUNDRED);
}

export interface PriceInput {
  purchasePriceExcTax?: Decimalish;
  purchasePriceIncTax?: Decimalish;
  profitPercent?: Decimalish;
  sellingPriceExcTax?: Decimalish;
  sellingPriceIncTax?: Decimalish;
}

/** Columns of `variations` that hold the prices. */
export interface VariationPrices {
  default_purchase_price: Prisma.Decimal;
  dpp_inc_tax: Prisma.Decimal;
  profit_percent: Prisma.Decimal;
  default_sell_price: Prisma.Decimal;
  sell_price_inc_tax: Prisma.Decimal;
}

function assertNotNegative(label: string, v: Prisma.Decimal): void {
  if (v.isNegative()) throw new BadRequestException(`${label} cannot be negative`);
}

/**
 * Works out all five stored prices of one variation.
 *
 * Purchase: the price excluding tax is the master value (falls back to the including-tax value, which is
 * divided by the tax). Selling: Laravel only shows one selling field, chosen by the product tax type
 * (inclusive -> price incl. tax, exclusive -> price excl. tax). That field is the master; when it is missing
 * the other selling price is used, and when neither is given the profit percent builds the price from the
 * purchase price. The profit percent is always recomputed from purchase and selling price, so the five
 * stored values are always consistent with each other.
 */
export function calculateVariationPrices(input: PriceInput, taxRatePercent: Decimalish, taxType: TaxType): VariationPrices {
  const tax = toDecimal(taxRatePercent);
  assertNotNegative('Tax rate', tax);

  // --- purchase price
  let purchaseExc: Prisma.Decimal;
  if (isGiven(input.purchasePriceExcTax)) {
    purchaseExc = toDecimal(input.purchasePriceExcTax);
  } else if (isGiven(input.purchasePriceIncTax)) {
    purchaseExc = principleOf(toDecimal(input.purchasePriceIncTax), tax);
  } else {
    purchaseExc = ZERO;
  }
  assertNotNegative('Purchase price', purchaseExc);
  purchaseExc = round4(purchaseExc);
  const purchaseInc = round4(addPercent(purchaseExc, tax));

  // --- selling price
  const hasExc = isGiven(input.sellingPriceExcTax);
  const hasInc = isGiven(input.sellingPriceIncTax);
  const useInc = taxType === 'inclusive' ? hasInc || !hasExc : !hasExc && hasInc;
  let sellExc: Prisma.Decimal;
  let sellInc: Prisma.Decimal;
  if (useInc && hasInc) {
    sellInc = round4(toDecimal(input.sellingPriceIncTax));
    sellExc = round4(principleOf(sellInc, tax));
  } else if (hasExc) {
    sellExc = round4(toDecimal(input.sellingPriceExcTax));
    sellInc = round4(addPercent(sellExc, tax));
  } else {
    const profit = toDecimal(input.profitPercent);
    sellExc = round4(addPercent(purchaseExc, profit));
    sellInc = round4(addPercent(sellExc, tax));
  }
  assertNotNegative('Selling price', sellExc);

  return {
    default_purchase_price: purchaseExc,
    dpp_inc_tax: purchaseInc,
    profit_percent: round4(ratePercent(purchaseExc, sellExc)),
    default_sell_price: sellExc,
    sell_price_inc_tax: sellInc,
  };
}

export interface ComboLine {
  quantity: Decimalish;
  /** Unit multiplier of the chosen sub-unit (1 for the base unit). */
  multiplier: Decimalish;
  /** Purchase price excluding tax of the component variation. */
  purchasePrice: Decimalish;
}

/** Purchase price (excl. tax) of a combo: sum of quantity x unit multiplier x component purchase price. */
export function comboPurchaseTotal(lines: ComboLine[]): Prisma.Decimal {
  return round4(
    lines.reduce((sum, l) => {
      const qty = toDecimal(l.quantity);
      if (!qty.gt(0)) throw new BadRequestException('Combo quantities must be greater than zero');
      return sum.add(qty.mul(isGiven(l.multiplier) ? toDecimal(l.multiplier) : new Prisma.Decimal(1)).mul(toDecimal(l.purchasePrice)));
    }, ZERO),
  );
}

/**
 * Price of a variation in a selling price group: `fixed` is the price including tax, `percentage` is a
 * percentage of the variation's normal selling price (same as Laravel's `calculated_price`).
 */
export function groupPrice(priceType: 'fixed' | 'percentage', value: Decimalish, sellPriceIncTax: Decimalish): Prisma.Decimal {
  const v = toDecimal(value);
  if (priceType === 'fixed') return round4(v);
  return round4(toDecimal(sellPriceIncTax).mul(v).div(HUNDRED));
}

/** Total value of an opening stock line: unit price including tax x quantity. */
export function openingStockLine(purchasePrice: Decimalish, quantity: Decimalish, taxRatePercent: Decimalish) {
  const price = round4(toDecimal(purchasePrice));
  const qty = toDecimal(quantity);
  const itemTax = round4(price.mul(toDecimal(taxRatePercent)).div(HUNDRED));
  const priceIncTax = round4(price.add(itemTax));
  return { purchasePrice: price, itemTax, priceIncTax, total: round4(priceIncTax.mul(qty)) };
}
