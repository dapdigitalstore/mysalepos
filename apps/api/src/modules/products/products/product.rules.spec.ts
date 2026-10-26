import {
  assertProductShape,
  escapeLike,
  firstDuplicate,
  generateProductSku,
  generateSubSku,
  parseComboVariations,
  parseSubUnitIds,
  permittedLocationIds,
  planOpeningStockLine,
  productDeletionBlocker,
  serializeSubUnitIds,
  stockStatus,
  variationRemovalBlocker,
} from './product.rules';

const none = { enableStock: true, purchaseLines: 0, soldOpeningStockLines: 0, adjustedLines: 0, sellLines: 0, stockAdjustmentLines: 0 };

describe('generateProductSku', () => {
  it('pads the id to 4 digits after the business prefix', () => {
    expect(generateProductSku('AB', 7)).toBe('AB0007');
    expect(generateProductSku(null, 129)).toBe('0129');
    expect(generateProductSku('', 12345)).toBe('12345');
  });
});

describe('generateSubSku', () => {
  it('numbers variations with a dash for Code 128 / Code 39', () => {
    expect(generateSubSku('SH01', 1, 'C128', 'Red', 'with_out_variation')).toBe('SH01-1');
    expect(generateSubSku('SH01', 2, 'C39', 'Red', undefined)).toBe('SH01-2');
  });
  it('numbers variations without a dash for numeric barcodes', () => {
    expect(generateSubSku('5901234', 3, 'EAN13', 'Red', 'with_out_variation')).toBe('59012343');
  });
  it('can build the SKU from the variation value', () => {
    expect(generateSubSku('SH01', 1, 'C128', 'Dark Blue / XL', 'with_variation')).toBe('SH01DarkBlueXL');
  });
  it('falls back to the running number when the value has no usable characters', () => {
    expect(generateSubSku('SH01', 4, 'C128', '---', 'with_variation')).toBe('SH01-4');
  });
});

describe('firstDuplicate', () => {
  it('finds repeats ignoring case and spaces around', () => {
    expect(firstDuplicate(['Red', 'Blue', ' red '])).toBe(' red ');
    expect(firstDuplicate(['Red', 'Blue'])).toBeNull();
  });
});

describe('sub unit and combo json', () => {
  it('stores sub-unit ids as a json array of strings, or null when empty', () => {
    expect(serializeSubUnitIds([2, 3, 3])).toBe('["2","3"]');
    expect(serializeSubUnitIds([])).toBeNull();
    expect(serializeSubUnitIds(undefined)).toBeNull();
  });
  it('reads what Laravel wrote and survives garbage', () => {
    expect(parseSubUnitIds('["2","3"]')).toEqual([2, 3]);
    expect(parseSubUnitIds('[4,5]')).toEqual([4, 5]);
    expect(parseSubUnitIds('nope')).toEqual([]);
    expect(parseSubUnitIds(null)).toEqual([]);
  });
  it('reads combo lines with string numbers and skips broken rows', () => {
    expect(parseComboVariations('[{"variation_id":"7","quantity":"2.5","unit_id":"1"},{"quantity":1}]')).toEqual([{ variation_id: 7, quantity: 2.5, unit_id: 1 }]);
    expect(parseComboVariations('[]')).toEqual([]);
    expect(parseComboVariations('{bad')).toEqual([]);
  });
});

describe('permittedLocationIds', () => {
  it('is unrestricted for admins and users with access_all_locations', () => {
    expect(permittedLocationIds({ isAdmin: true, isSuperadmin: false, permissions: [] })).toBeNull();
    expect(permittedLocationIds({ isAdmin: false, isSuperadmin: false, permissions: ['access_all_locations'] })).toBeNull();
  });
  it('lists the location.<id> permissions otherwise', () => {
    expect(permittedLocationIds({ isAdmin: false, isSuperadmin: false, permissions: ['product.view', 'location.2', 'location.9'] })).toEqual([2, 9]);
    expect(permittedLocationIds({ isAdmin: false, isSuperadmin: false, permissions: ['product.view'] })).toEqual([]);
  });
});

describe('stockStatus', () => {
  it('does not track products without stock management', () => {
    expect(stockStatus({ enableStock: false, qty: 5, alertQuantity: 1 })).toBe('not_tracked');
  });
  it('flags empty and negative stock as out of stock', () => {
    expect(stockStatus({ enableStock: true, qty: 0, alertQuantity: null })).toBe('out_of_stock');
    expect(stockStatus({ enableStock: true, qty: '-3', alertQuantity: null })).toBe('out_of_stock');
    expect(stockStatus({ enableStock: true, qty: null, alertQuantity: 2 })).toBe('out_of_stock');
  });
  it('flags stock at or below the alert quantity as low', () => {
    expect(stockStatus({ enableStock: true, qty: '5', alertQuantity: '5' })).toBe('low_stock');
    expect(stockStatus({ enableStock: true, qty: '6', alertQuantity: '5' })).toBe('in_stock');
    expect(stockStatus({ enableStock: true, qty: '6', alertQuantity: null })).toBe('in_stock');
  });
});

describe('escapeLike', () => {
  it('escapes wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('productDeletionBlocker', () => {
  it('allows a product with no history', () => {
    expect(productDeletionBlocker(none)).toBeNull();
  });
  it('blocks products with purchases', () => {
    expect(productDeletionBlocker({ ...none, purchaseLines: 1 })).toMatch(/purchases/);
  });
  it('blocks products whose opening stock was sold', () => {
    expect(productDeletionBlocker({ ...none, soldOpeningStockLines: 1 })).toMatch(/opening stock/);
  });
  it('blocks products with adjusted stock', () => {
    expect(productDeletionBlocker({ ...none, adjustedLines: 1 })).toMatch(/adjusted/);
    expect(productDeletionBlocker({ ...none, stockAdjustmentLines: 2 })).toMatch(/adjusted/);
  });
  it('blocks products that were sold, with or without stock management', () => {
    expect(productDeletionBlocker({ ...none, sellLines: 1 })).toMatch(/sales/);
    expect(productDeletionBlocker({ ...none, enableStock: false, sellLines: 4 })).toMatch(/sales/);
  });
});

describe('variationRemovalBlocker', () => {
  it('allows removing an unused variation', () => {
    expect(variationRemovalBlocker({ purchaseLines: 0, sellLines: 0, stockAdjustmentLines: 0 })).toBeNull();
  });
  it('blocks a variation with any history', () => {
    expect(variationRemovalBlocker({ purchaseLines: 1, sellLines: 0, stockAdjustmentLines: 0 })).not.toBeNull();
    expect(variationRemovalBlocker({ purchaseLines: 0, sellLines: 1, stockAdjustmentLines: 0 })).not.toBeNull();
    expect(variationRemovalBlocker({ purchaseLines: 0, sellLines: 0, stockAdjustmentLines: 1 })).not.toBeNull();
  });
});

describe('planOpeningStockLine', () => {
  it('adds a new line: stock rises by the quantity', () => {
    const p = planOpeningStockLine({ remaining: '10', used: '0', previousQuantity: '0' });
    expect(p.quantity.toString()).toBe('10');
    expect(p.stockDelta.toString()).toBe('10');
    expect(p.remove).toBe(false);
  });
  it('edits an existing line: the stored quantity is remaining + used', () => {
    // 300 stored, 9 sold, user edits the remaining 291 to 100 -> stored 109, stock falls by 191
    const p = planOpeningStockLine({ remaining: '100', used: '9', previousQuantity: '300' });
    expect(p.quantity.toString()).toBe('109');
    expect(p.stockDelta.toString()).toBe('-191');
  });
  it('removes a line that is emptied and was never used', () => {
    expect(planOpeningStockLine({ remaining: '0', used: '0', previousQuantity: '5' }).remove).toBe(true);
  });
  it('keeps a line that is emptied but already partly used', () => {
    expect(planOpeningStockLine({ remaining: '0', used: '4', previousQuantity: '10' }).remove).toBe(false);
  });
  it('rejects a negative quantity', () => {
    expect(() => planOpeningStockLine({ remaining: '-1', used: '0', previousQuantity: '0' })).toThrow();
  });
});

describe('assertProductShape', () => {
  it('accepts a plain single product', () => {
    expect(() => assertProductShape({ type: 'single', enableStock: true })).not.toThrow();
  });
  it('needs components for a combo', () => {
    expect(() => assertProductShape({ type: 'combo', comboItemCount: 0 })).toThrow();
    expect(() => assertProductShape({ type: 'combo', comboItemCount: 2 })).not.toThrow();
  });
  it('needs variations for a variable product', () => {
    expect(() => assertProductShape({ type: 'variable' })).toThrow();
    expect(() => assertProductShape({ type: 'variable', variationGroups: [{ name: 'Size', variations: [] }] })).toThrow();
    expect(() => assertProductShape({ type: 'variable', variationGroups: [{ name: 'Size', variations: [{ name: 'S' }, { name: 'M' }] }] })).not.toThrow();
  });
  it('rejects repeated variation names and repeated values', () => {
    expect(() =>
      assertProductShape({ type: 'variable', variationGroups: [{ name: 'Size', variations: [{ name: 'S' }] }, { name: 'size', variations: [{ name: 'M' }] }] }),
    ).toThrow();
    expect(() => assertProductShape({ type: 'variable', variationGroups: [{ name: 'Size', variations: [{ name: 'S' }, { name: 's' }] }] })).toThrow();
  });
  it('lets an update leave components and variations out to keep them', () => {
    expect(() => assertProductShape({ type: 'combo', partial: true })).not.toThrow();
    expect(() => assertProductShape({ type: 'combo', partial: true, comboItemCount: 0 })).toThrow();
    expect(() => assertProductShape({ type: 'variable', partial: true })).not.toThrow();
    expect(() => assertProductShape({ type: 'variable', partial: true, variationGroups: [] })).toThrow();
  });
  it('only allows an expiry period when stock is managed', () => {
    expect(() => assertProductShape({ type: 'single', enableStock: false, expiryPeriod: 3, expiryPeriodType: 'months' })).toThrow();
    expect(() => assertProductShape({ type: 'single', enableStock: true, expiryPeriod: 3 })).toThrow();
    expect(() => assertProductShape({ type: 'single', enableStock: true, expiryPeriod: 3, expiryPeriodType: 'months' })).not.toThrow();
  });
});
