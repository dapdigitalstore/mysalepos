/**
 * Live price calculator for the product form. Same formulas as the API (apps/api .../pricing.rules.ts) and Laravel's product.js.
 * This is a preview only: the API recalculates and stores the final values. Values are strings so the inputs stay editable.
 */

export type TaxType = 'inclusive' | 'exclusive';

export interface PriceFields {
  purchaseExc: string;
  purchaseInc: string;
  profit: string;
  sellExc: string;
  sellInc: string;
}

export type PriceField = keyof PriceFields;

export const emptyPrices = (profit = '0'): PriceFields => ({ purchaseExc: '', purchaseInc: '', profit, sellExc: '', sellInc: '' });

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 4 decimals like the database, without trailing zeros. */
const out = (n: number): string => String(Math.round((n + Number.EPSILON) * 10000) / 10000);

const addPercent = (amount: number, pct: number) => amount + (amount * pct) / 100;
const principle = (amountInc: number, pct: number) => (amountInc * 100) / (100 + pct);
const rate = (principal: number, amount: number) => (principal === 0 ? 0 : ((amount - principal) / principal) * 100);

/** Recalculates the other fields after `changed` was edited, the way the Laravel form does. */
export function recalc(prices: PriceFields, changed: PriceField | 'tax', taxPercent: number): PriceFields {
  const p = { ...prices };
  switch (changed) {
    case 'purchaseExc':
    case 'tax': {
      const exc = num(p.purchaseExc);
      p.purchaseInc = p.purchaseExc === '' ? '' : out(addPercent(exc, taxPercent));
      if (changed === 'tax') {
        p.sellInc = p.sellExc === '' ? '' : out(addPercent(num(p.sellExc), taxPercent));
        // keep profit in step with the (unchanged) selling price excluding tax
        break;
      }
      const sellExc = addPercent(exc, num(p.profit));
      p.sellExc = out(sellExc);
      p.sellInc = out(addPercent(sellExc, taxPercent));
      break;
    }
    case 'purchaseInc': {
      const exc = principle(num(p.purchaseInc), taxPercent);
      p.purchaseExc = p.purchaseInc === '' ? '' : out(exc);
      const sellExc = addPercent(exc, num(p.profit));
      p.sellExc = out(sellExc);
      p.sellInc = out(addPercent(sellExc, taxPercent));
      break;
    }
    case 'profit': {
      const sellExc = addPercent(num(p.purchaseExc), num(p.profit));
      p.sellExc = out(sellExc);
      p.sellInc = out(addPercent(sellExc, taxPercent));
      break;
    }
    case 'sellExc': {
      p.profit = out(rate(num(p.purchaseExc), num(p.sellExc)));
      p.sellInc = p.sellExc === '' ? '' : out(addPercent(num(p.sellExc), taxPercent));
      break;
    }
    case 'sellInc': {
      const sellExc = principle(num(p.sellInc), taxPercent);
      p.sellExc = p.sellInc === '' ? '' : out(sellExc);
      p.profit = out(rate(num(p.purchaseExc), sellExc));
      break;
    }
  }
  return p;
}

/** Purchase price (excl. tax) of a combo: quantity x unit multiplier x purchase price, summed. */
export function comboTotal(lines: { quantity: string; multiplier: string; purchasePrice: string }[]): number {
  return lines.reduce((sum, l) => sum + num(l.quantity) * (num(l.multiplier) || 1) * num(l.purchasePrice), 0);
}

export const toApiPrices = (p: PriceFields) => ({
  ...(p.purchaseExc !== '' ? { purchasePriceExcTax: p.purchaseExc } : {}),
  ...(p.purchaseInc !== '' ? { purchasePriceIncTax: p.purchaseInc } : {}),
  profitPercent: p.profit === '' ? '0' : p.profit,
  ...(p.sellExc !== '' ? { sellingPriceExcTax: p.sellExc } : {}),
  ...(p.sellInc !== '' ? { sellingPriceIncTax: p.sellInc } : {}),
});

/** A decimal string for form inputs: drops the trailing zeros the API keeps. */
export const trimNumber = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
