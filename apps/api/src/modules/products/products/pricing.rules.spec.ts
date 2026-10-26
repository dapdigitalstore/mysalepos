import { Prisma } from '@prisma/client';
import { addPercent, calculateVariationPrices, comboPurchaseTotal, groupPrice, openingStockLine, principleOf, ratePercent, round4, toDecimal } from './pricing.rules';

const d = (v: string | number) => new Prisma.Decimal(v);
const s = (v: Prisma.Decimal) => v.toFixed(4);

describe('decimal helpers', () => {
  it('parses numbers and numeric strings, treats missing as zero', () => {
    expect(toDecimal('12.5').toString()).toBe('12.5');
    expect(toDecimal(3).toString()).toBe('3');
    expect(toDecimal(null).toString()).toBe('0');
    expect(toDecimal('').toString()).toBe('0');
  });
  it('rejects garbage and non finite numbers', () => {
    expect(() => toDecimal('abc')).toThrow();
    expect(() => toDecimal(Number.NaN)).toThrow();
    expect(() => toDecimal(Infinity)).toThrow();
  });
  it('adds a percentage without float error', () => {
    expect(s(addPercent(d('0.1'), d('0.2')))).toBe('0.1002');
    expect(s(addPercent(d(1000), d(18)))).toBe('1180.0000');
  });
  it('is the inverse of addPercent for tax', () => {
    expect(s(principleOf(d('1180'), d(18)))).toBe('1000.0000');
    expect(s(principleOf(d('137.5'), d(10)))).toBe('125.0000');
  });
  it('gives zero profit rate when there is no purchase price', () => {
    expect(ratePercent(d(0), d(500)).toString()).toBe('0');
    expect(s(ratePercent(d(100), d(125)))).toBe('25.0000');
  });
  it('rounds half up to 4 decimals', () => {
    expect(round4(d('1.23455')).toString()).toBe('1.2346');
    expect(round4(d('1.23454')).toString()).toBe('1.2345');
  });
});

describe('calculateVariationPrices', () => {
  it('exclusive tax: builds selling price from profit percent', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: 100, profitPercent: 25 }, 10, 'exclusive');
    expect(s(p.default_purchase_price)).toBe('100.0000');
    expect(s(p.dpp_inc_tax)).toBe('110.0000');
    expect(s(p.default_sell_price)).toBe('125.0000');
    expect(s(p.sell_price_inc_tax)).toBe('137.5000');
    expect(s(p.profit_percent)).toBe('25.0000');
  });

  it('exclusive tax: selling price excl. tax drives the profit percent', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: 200, sellingPriceExcTax: 250, profitPercent: 99 }, 0, 'exclusive');
    expect(s(p.default_sell_price)).toBe('250.0000');
    expect(s(p.sell_price_inc_tax)).toBe('250.0000');
    expect(s(p.profit_percent)).toBe('25.0000');
  });

  it('inclusive tax: the price including tax is the master selling value', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: 100, sellingPriceIncTax: 137.5 }, 10, 'inclusive');
    expect(s(p.sell_price_inc_tax)).toBe('137.5000');
    expect(s(p.default_sell_price)).toBe('125.0000');
    expect(s(p.profit_percent)).toBe('25.0000');
  });

  it('inclusive tax keeps the typed price including tax exactly, even when dividing would not round-trip', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: 100, sellingPriceIncTax: 199.99 }, 15, 'inclusive');
    expect(s(p.sell_price_inc_tax)).toBe('199.9900');
    expect(s(p.default_sell_price)).toBe('173.9043');
  });

  it('falls back to the other selling price when the master one is missing', () => {
    const inc = calculateVariationPrices({ purchasePriceExcTax: 100, sellingPriceExcTax: 150 }, 10, 'inclusive');
    expect(s(inc.default_sell_price)).toBe('150.0000');
    expect(s(inc.sell_price_inc_tax)).toBe('165.0000');
    const exc = calculateVariationPrices({ purchasePriceExcTax: 100, sellingPriceIncTax: 165 }, 10, 'exclusive');
    expect(s(exc.default_sell_price)).toBe('150.0000');
    expect(s(exc.profit_percent)).toBe('50.0000');
  });

  it('derives the purchase price excl. tax from the price including tax', () => {
    const p = calculateVariationPrices({ purchasePriceIncTax: 118, profitPercent: 10 }, 18, 'exclusive');
    expect(s(p.default_purchase_price)).toBe('100.0000');
    expect(s(p.dpp_inc_tax)).toBe('118.0000');
    expect(s(p.default_sell_price)).toBe('110.0000');
    expect(s(p.sell_price_inc_tax)).toBe('129.8000');
  });

  it('profit percent round trip: percent -> selling price -> percent', () => {
    for (const percent of [0, 5, 12.5, 33.3333, 100]) {
      const first = calculateVariationPrices({ purchasePriceExcTax: '80', profitPercent: percent }, 8, 'exclusive');
      const second = calculateVariationPrices({ purchasePriceExcTax: '80', sellingPriceExcTax: first.default_sell_price }, 8, 'exclusive');
      expect(second.profit_percent.sub(first.profit_percent).abs().lte('0.01')).toBe(true);
    }
  });

  it('has zero profit percent for a free item and still stores the selling price', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: 0, sellingPriceExcTax: 500 }, 0, 'exclusive');
    expect(s(p.profit_percent)).toBe('0.0000');
    expect(s(p.default_sell_price)).toBe('500.0000');
  });

  it('treats nothing given as zero prices', () => {
    const p = calculateVariationPrices({}, 10, 'exclusive');
    expect(s(p.default_purchase_price)).toBe('0.0000');
    expect(s(p.sell_price_inc_tax)).toBe('0.0000');
  });

  it('does not lose cents on awkward decimals', () => {
    const p = calculateVariationPrices({ purchasePriceExcTax: '0.1', profitPercent: '200' }, 0, 'exclusive');
    expect(s(p.default_sell_price)).toBe('0.3000');
  });

  it('rejects negative prices and negative tax', () => {
    expect(() => calculateVariationPrices({ purchasePriceExcTax: -1 }, 0, 'exclusive')).toThrow();
    expect(() => calculateVariationPrices({ purchasePriceExcTax: 1, sellingPriceExcTax: -5 }, 0, 'exclusive')).toThrow();
    expect(() => calculateVariationPrices({ purchasePriceExcTax: 1 }, -1, 'exclusive')).toThrow();
  });
});

describe('comboPurchaseTotal', () => {
  it('sums quantity x multiplier x purchase price', () => {
    const total = comboPurchaseTotal([
      { quantity: 2, multiplier: 1, purchasePrice: '10.50' },
      { quantity: 1, multiplier: 12, purchasePrice: '5' },
    ]);
    expect(s(total)).toBe('81.0000');
  });
  it('treats a missing multiplier as 1', () => {
    expect(s(comboPurchaseTotal([{ quantity: 3, multiplier: null, purchasePrice: 2 }]))).toBe('6.0000');
  });
  it('is zero for no lines and rejects non positive quantities', () => {
    expect(s(comboPurchaseTotal([]))).toBe('0.0000');
    expect(() => comboPurchaseTotal([{ quantity: 0, multiplier: 1, purchasePrice: 1 }])).toThrow();
  });
});

describe('groupPrice', () => {
  it('returns the fixed price including tax as is', () => {
    expect(s(groupPrice('fixed', '90', '100'))).toBe('90.0000');
  });
  it('calculates a percentage of the normal selling price', () => {
    expect(s(groupPrice('percentage', '90', '250'))).toBe('225.0000');
  });
});

describe('openingStockLine', () => {
  it('adds product tax to the unit price and totals the line', () => {
    const l = openingStockLine('100', '3', 10);
    expect(s(l.itemTax)).toBe('10.0000');
    expect(s(l.priceIncTax)).toBe('110.0000');
    expect(s(l.total)).toBe('330.0000');
  });
  it('works without tax', () => {
    const l = openingStockLine('450', '300', 0);
    expect(s(l.total)).toBe('135000.0000');
  });
});
