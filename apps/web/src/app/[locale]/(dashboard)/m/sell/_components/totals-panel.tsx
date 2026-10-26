'use client';

import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { cn, formatMoney } from '@/lib/utils';
import type { CartTotals, SaleHeader } from '../_lib/cart';
import { isZero, toFixed, toText } from '../_lib/decimal';
import type { SaleSettings } from '../_lib/sale-types';
import { flag } from './use-sale-settings';

interface Props {
  settings: SaleSettings;
  header: SaleHeader;
  onHeader: (patch: Partial<SaleHeader>) => void;
  totals: CartTotals;
  /** `pos` honours the POS "disable discount / order tax" switches; `form` is the add / edit sale screen (also shows the extra charges). */
  variant: 'pos' | 'form';
  discountRef?: RefObject<HTMLInputElement>;
  className?: string;
}

const numeric = (v: string): string => v.replace(/[^\d.]/g, '');

/** Invoice discount, order tax, shipping, extra charges and the live totals. Everything shown is computed from the cart, nothing is typed in. */
export function TotalsPanel({ settings, header, onHeader, totals, variant, discountRef, className }: Props) {
  const t = useTranslations('pos');
  const cp = settings.business.currencyPrecision;
  const money = (d: Parameters<typeof toFixed>[0]) => formatMoney(toFixed(d, cp));
  const showDiscount = settings.permissions.canDiscount && !(variant === 'pos' && flag(settings.posSettings.disable_discount));
  const showTax = !(variant === 'pos' && flag(settings.posSettings.disable_order_tax));
  const showShipping = settings.permissions.canShip;

  return (
    <div className={cn('space-y-2 text-sm', className)}>
      <Row label={t('items')} value={toText(totals.itemCount)} />
      <Row label={t('subtotal')} value={money(totals.totalBeforeTax)} />

      {showDiscount && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="inv-discount" className="text-slate-600">
            {t('invoiceDiscount')}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex">
              <Input
                id="inv-discount"
                ref={discountRef}
                value={header.discountAmount === '0' ? '' : header.discountAmount}
                onChange={(e) => onHeader({ discountAmount: numeric(e.target.value) || '0' })}
                inputMode="decimal"
                placeholder="0"
                className="h-10 w-24 rounded-e-none text-end"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Select
                value={header.discountType}
                onChange={(e) => onHeader({ discountType: e.target.value === 'fixed' ? 'fixed' : 'percentage' })}
                aria-label={t('discountType')}
                className="h-10 w-16 rounded-s-none border-s-0 px-1"
              >
                <option value="percentage">%</option>
                <option value="fixed">{t('fixedShort')}</option>
              </Select>
            </div>
            <span className="w-28 text-end font-medium text-slate-700">{isZero(totals.discount) ? '-' : `- ${money(totals.discount)}`}</span>
          </div>
        </div>
      )}

      {showTax && settings.taxRates.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="order-tax" className="text-slate-600">
            {t('orderTax')}
          </label>
          <div className="flex items-center gap-2">
            <Select
              id="order-tax"
              value={header.taxRateId ?? ''}
              onChange={(e) => onHeader({ taxRateId: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-10 w-40"
            >
              <option value="">{t('noTax')}</option>
              {settings.taxRates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.rate}%)
                </option>
              ))}
            </Select>
            <span className="w-28 text-end font-medium text-slate-700">{isZero(totals.tax) ? '-' : money(totals.tax)}</span>
          </div>
        </div>
      )}

      {showShipping && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="shipping-charges" className="text-slate-600">
            {t('shippingCharges')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="shipping-charges"
              value={header.shippingCharges}
              onChange={(e) => onHeader({ shippingCharges: numeric(e.target.value) })}
              inputMode="decimal"
              placeholder="0"
              className="h-10 w-40 text-end"
              onFocus={(e) => e.currentTarget.select()}
            />
            <span className="w-28 text-end font-medium text-slate-700">{isZero(totals.shipping) ? '-' : money(totals.shipping)}</span>
          </div>
        </div>
      )}

      {variant === 'form' && (
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">{t('additionalExpenses')}</legend>
          {header.additionalExpenses.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem] gap-2">
              <Input
                value={e.key}
                onChange={(ev) => onHeader({ additionalExpenses: header.additionalExpenses.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)) })}
                placeholder={t('expenseName')}
                aria-label={t('expenseNameN', { n: i + 1 })}
                maxLength={191}
                className="h-10"
              />
              <Input
                value={e.value}
                onChange={(ev) => onHeader({ additionalExpenses: header.additionalExpenses.map((x, j) => (j === i ? { ...x, value: numeric(ev.target.value) } : x)) })}
                inputMode="decimal"
                placeholder="0"
                aria-label={t('expenseAmountN', { n: i + 1 })}
                className="h-10 text-end"
              />
            </div>
          ))}
        </fieldset>
      )}

      {!isZero(totals.roundOff) && <Row label={t('roundOff')} value={money(totals.roundOff)} />}

      <div className="flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="text-base font-semibold text-slate-900">{t('totalPayable')}</span>
        <span className="text-2xl font-bold text-primary-dark" aria-live="polite">
          {money(totals.finalTotal)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
