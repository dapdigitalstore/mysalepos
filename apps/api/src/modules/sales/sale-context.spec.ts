import { Prisma } from '@prisma/client';
import { productLabel, stopSellingCutoffDay, type BusinessCtx } from './sale-context';

const biz = (over: Partial<BusinessCtx>): BusinessCtx =>
  ({ timeZone: 'Asia/Colombo', enableProductExpiry: true, onProductExpiry: 'stop_selling', stopSellingBefore: 5, ...over }) as BusinessCtx;

describe('stopSellingCutoffDay', () => {
  it('is the business-local today plus the stop-selling days', () => {
    // 2026-03-30 20:00 UTC is already 2026-03-31 in Colombo (UTC+5:30)
    expect(stopSellingCutoffDay(biz({}), new Date('2026-03-30T20:00:00Z'))).toBe('2026-04-05');
  });
  it('is off unless expiry is enabled with the stop_selling rule', () => {
    expect(stopSellingCutoffDay(biz({ enableProductExpiry: false }))).toBeNull();
    expect(stopSellingCutoffDay(biz({ onProductExpiry: 'keep_selling' }))).toBeNull();
  });
});

describe('productLabel', () => {
  it('shows the variation only for variable products and always the SKU', () => {
    expect(productLabel('Tea', 'DUMMY', true, 'T1')).toBe('Tea SKU: T1');
    expect(productLabel('Shirt', 'M', false, 'S-M')).toBe('Shirt (M) SKU: S-M');
    expect(productLabel('Tea', null, true, null)).toBe('Tea');
    expect(new Prisma.Decimal(1).toFixed()).toBe('1');
  });
});
