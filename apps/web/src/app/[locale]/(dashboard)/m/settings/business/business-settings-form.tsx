'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface Option {
  id: number | string;
  label: string;
}

interface Settings {
  general: {
    name: string; startDate: string | null; currencyId: number; timeZone: string; fyStartMonth: number; accountingMethod: string;
    dateFormat: string; timeFormat: string; currencyPrecision: number; quantityPrecision: number; transactionEditDays: number;
  };
  tax: {
    taxLabel1: string | null; taxNumber1: string | null; taxLabel2: string | null; taxNumber2: string | null; defaultSalesTax: number | null;
    defaultSalesDiscount: string; sellPriceTax: string; enablePriceTax: boolean; enableInlineTax: boolean;
  };
  product: {
    skuPrefix: string | null; defaultProfitPercent: number; defaultUnit: number | null; enableBrand: boolean; enableCategory: boolean;
    enableSubCategory: boolean; enableSubUnits: boolean; enableRacks: boolean; enableRow: boolean; enablePosition: boolean; enableLotNumber: boolean;
    enableProductExpiry: boolean; expiryType: string; onProductExpiry: string; stopSellingBefore: number; stockExpiryAlertDays: number;
    enableEditingProductFromPurchase: boolean; enablePurchaseStatus: boolean;
  };
  refNoPrefixes: Record<string, string | null>;
  enabledModules: string[];
}

type Values = Record<string, string | boolean>;

const TABS = ['general', 'tax', 'product', 'prefixes', 'features'] as const;
type Tab = (typeof TABS)[number];

const FEATURES = ['purchases', 'add_sale', 'pos_sale', 'stock_transfers', 'stock_adjustment', 'expenses', 'account', 'tables', 'modifiers', 'service_staff', 'booking', 'kitchen', 'subscription', 'types_of_service'];
const PREFIX_TYPES = ['purchase', 'purchase_return', 'purchase_requisition', 'purchase_order', 'stock_transfer', 'stock_adjustment', 'sell_return', 'expense', 'contacts', 'purchase_payment', 'sell_payment', 'expense_payment', 'business_location', 'username', 'subscription', 'draft', 'sales_order'];
const CHECKS = ['enableBrand', 'enableCategory', 'enableSubCategory', 'enableSubUnits', 'enableRacks', 'enableRow', 'enablePosition', 'enableLotNumber', 'enableProductExpiry', 'enableEditingProductFromPurchase', 'enablePurchaseStatus', 'enablePriceTax', 'enableInlineTax'];

const s = (v: string | number | null | undefined) => (v == null ? '' : String(v));
const num = (v: string | boolean) => Number(v);
const optNum = (v: string | boolean) => (v === '' ? null : Number(v));
const optText = (v: string | boolean) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function toValues(d: Settings): Values {
  const v: Values = {
    name: d.general.name, startDate: s(d.general.startDate), currencyId: s(d.general.currencyId), timeZone: d.general.timeZone, fyStartMonth: s(d.general.fyStartMonth),
    accountingMethod: d.general.accountingMethod, dateFormat: d.general.dateFormat, timeFormat: d.general.timeFormat,
    currencyPrecision: s(d.general.currencyPrecision), quantityPrecision: s(d.general.quantityPrecision), transactionEditDays: s(d.general.transactionEditDays),
    taxLabel1: s(d.tax.taxLabel1), taxNumber1: s(d.tax.taxNumber1), taxLabel2: s(d.tax.taxLabel2), taxNumber2: s(d.tax.taxNumber2), defaultSalesTax: s(d.tax.defaultSalesTax),
    defaultSalesDiscount: s(d.tax.defaultSalesDiscount), sellPriceTax: d.tax.sellPriceTax,
    skuPrefix: s(d.product.skuPrefix), defaultProfitPercent: s(d.product.defaultProfitPercent), defaultUnit: s(d.product.defaultUnit), expiryType: d.product.expiryType,
    onProductExpiry: d.product.onProductExpiry, stopSellingBefore: s(d.product.stopSellingBefore), stockExpiryAlertDays: s(d.product.stockExpiryAlertDays),
  };
  const flags: Record<string, boolean> = { ...d.tax, ...d.product } as unknown as Record<string, boolean>;
  for (const k of CHECKS) v[k] = Boolean(flags[k]);
  for (const p of PREFIX_TYPES) v[`prefix_${p}`] = s(d.refNoPrefixes[p]);
  for (const f of FEATURES) v[`feature_${f}`] = d.enabledModules.includes(f);
  return v;
}

function toPayload(v: Values) {
  return {
    name: v.name, startDate: v.startDate || null, currencyId: num(v.currencyId), timeZone: v.timeZone, fyStartMonth: num(v.fyStartMonth),
    accountingMethod: v.accountingMethod, dateFormat: v.dateFormat, timeFormat: v.timeFormat, currencyPrecision: num(v.currencyPrecision),
    quantityPrecision: num(v.quantityPrecision), transactionEditDays: num(v.transactionEditDays),
    taxLabel1: optText(v.taxLabel1), taxNumber1: optText(v.taxNumber1), taxLabel2: optText(v.taxLabel2), taxNumber2: optText(v.taxNumber2),
    defaultSalesTax: optNum(v.defaultSalesTax), defaultSalesDiscount: num(v.defaultSalesDiscount || '0'), sellPriceTax: v.sellPriceTax,
    skuPrefix: optText(v.skuPrefix), defaultProfitPercent: num(v.defaultProfitPercent || '0'), defaultUnit: optNum(v.defaultUnit), expiryType: v.expiryType,
    onProductExpiry: v.onProductExpiry, stopSellingBefore: optNum(v.stopSellingBefore), stockExpiryAlertDays: num(v.stockExpiryAlertDays || '30'),
    ...Object.fromEntries(CHECKS.map((k) => [k, Boolean(v[k])])),
    refNoPrefixes: Object.fromEntries(PREFIX_TYPES.map((p) => [p, optText(v[`prefix_${p}`])])),
    enabledModules: FEATURES.filter((f) => v[`feature_${f}`]),
  };
}

export function BusinessSettingsForm() {
  const t = useTranslations('businessSettings');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('general');
  const allowed = can('business_settings.access');

  const settings = useQuery({ queryKey: ['business-settings'], queryFn: () => api<Settings>('/business/settings'), enabled: allowed });
  const currencies = useQuery({ queryKey: ['options', '/currencies/options'], queryFn: () => api<Option[]>('/currencies/options'), enabled: allowed });
  const zones = useQuery({ queryKey: ['options', '/time-zones/options'], queryFn: () => api<Option[]>('/time-zones/options'), enabled: allowed });
  const taxes = useQuery({ queryKey: ['options', '/tax-rates/options'], queryFn: () => api<Option[]>('/tax-rates/options'), enabled: allowed });
  const units = useQuery({ queryKey: ['options', '/units/options'], queryFn: () => api<Option[]>('/units/options'), enabled: allowed });

  const form = useForm<Values>({ defaultValues: {} });
  const { register, handleSubmit, reset, formState } = form;
  useEffect(() => {
    if (settings.data) reset(toValues(settings.data));
  }, [settings.data, reset]);

  const save = useMutation({
    mutationFn: (v: Values) => api<Settings>('/business/settings', { method: 'PUT', body: toPayload(v) }),
    onSuccess: (data) => {
      toast.success(c('saved'));
      qc.setQueryData(['business-settings'], data);
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  if (!allowed) return <p className="text-slate-600">{t('noAccess')}</p>;

  const text = (name: string, label: string, opts?: { type?: string; hint?: string; step?: string; max?: number }) => (
    <Field label={label} htmlFor={name} hint={opts?.hint}>
      <Input id={name} type={opts?.type} step={opts?.step} maxLength={opts?.max} {...register(name)} />
    </Field>
  );
  const select = (name: string, label: string, options: Option[] | { id: string; label: string }[], empty?: string) => (
    <Field label={label} htmlFor={name}>
      <Select id={name} {...register(name)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </Select>
    </Field>
  );
  const check = (name: string, label: string) => <Checkbox id={name} label={label} {...register(name)} />;

  const section = (id: Tab, children: React.ReactNode) => (
    <div role="tabpanel" id={`panel-${id}`} hidden={tab !== id} className="grid gap-4 sm:grid-cols-2">
      {children}
    </div>
  );

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button type="submit" disabled={save.isPending || !formState.isDirty}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        }
      />
      <div role="tablist" aria-label={t('title')} className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', tab === id ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-100')}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>

      {settings.isLoading && <Card className="h-40 animate-pulse" />}
      {settings.isError && <Card role="alert" className="text-red-700">{c('loadError')}</Card>}
      {settings.data && (
        <Card>
          {section('general', <>
            {text('name', t('name'))}
            {text('startDate', t('startDate'), { type: 'date' })}
            {select('currencyId', t('currency'), currencies.data ?? [])}
            {select('timeZone', t('timeZone'), zones.data ?? [{ id: settings.data.general.timeZone, label: settings.data.general.timeZone }])}
            {select('fyStartMonth', t('fyStartMonth'), Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: new Date(2000, i, 1).toLocaleString('en', { month: 'long' }) })))}
            {select('accountingMethod', t('accountingMethod'), [{ id: 'fifo', label: t('fifo') }, { id: 'lifo', label: t('lifo') }, { id: 'avco', label: t('avco') }])}
            {text('dateFormat', t('dateFormat'), { hint: t('dateFormatHint') })}
            {select('timeFormat', t('timeFormat'), [{ id: '12', label: t('hours12') }, { id: '24', label: t('hours24') }])}
            {text('currencyPrecision', t('currencyPrecision'), { type: 'number' })}
            {text('quantityPrecision', t('quantityPrecision'), { type: 'number' })}
            {text('transactionEditDays', t('transactionEditDays'), { type: 'number', hint: t('transactionEditDaysHint') })}
          </>)}
          {section('tax', <>
            {text('taxLabel1', t('taxLabel1'), { max: 10 })}
            {text('taxNumber1', t('taxNumber1'))}
            {text('taxLabel2', t('taxLabel2'), { max: 10 })}
            {text('taxNumber2', t('taxNumber2'))}
            {select('defaultSalesTax', t('defaultSalesTax'), taxes.data ?? [], t('none'))}
            {text('defaultSalesDiscount', t('defaultSalesDiscount'), { type: 'number', step: '0.01' })}
            {select('sellPriceTax', t('sellPriceTax'), [{ id: 'includes', label: t('includesTax') }, { id: 'excludes', label: t('excludesTax') }])}
            <div className="space-y-2 sm:col-span-2">
              {check('enablePriceTax', t('enablePriceTax'))}
              {check('enableInlineTax', t('enableInlineTax'))}
            </div>
          </>)}
          {section('product', <>
            {text('skuPrefix', t('skuPrefix'))}
            {text('defaultProfitPercent', t('defaultProfitPercent'), { type: 'number', step: '0.01' })}
            {select('defaultUnit', t('defaultUnit'), units.data ?? [], t('none'))}
            {text('stockExpiryAlertDays', t('stockExpiryAlertDays'), { type: 'number' })}
            {select('expiryType', t('expiryType'), [{ id: 'add_expiry', label: t('addExpiry') }, { id: 'add_manufacturing', label: t('addManufacturing') }])}
            {select('onProductExpiry', t('onProductExpiry'), [{ id: 'keep_selling', label: t('keepSelling') }, { id: 'stop_selling', label: t('stopSelling') }, { id: 'auto_delete', label: t('autoDelete') }])}
            {text('stopSellingBefore', t('stopSellingBefore'), { type: 'number', hint: t('stopSellingBeforeHint') })}
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              {check('enableBrand', t('enableBrand'))}
              {check('enableCategory', t('enableCategory'))}
              {check('enableSubCategory', t('enableSubCategory'))}
              {check('enableSubUnits', t('enableSubUnits'))}
              {check('enableRacks', t('enableRacks'))}
              {check('enableRow', t('enableRow'))}
              {check('enablePosition', t('enablePosition'))}
              {check('enableLotNumber', t('enableLotNumber'))}
              {check('enableProductExpiry', t('enableProductExpiry'))}
              {check('enableEditingProductFromPurchase', t('enableEditingProductFromPurchase'))}
              {check('enablePurchaseStatus', t('enablePurchaseStatus'))}
            </div>
          </>)}
          {section('prefixes', <>
            <p className="text-sm text-slate-500 sm:col-span-2">{t('prefixesHint')}</p>
            {PREFIX_TYPES.map((p) => text(`prefix_${p}`, t(`prefix.${p}`), { max: 10 }))}
          </>)}
          {section('features', <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">{FEATURES.map((f) => check(`feature_${f}`, t(`feature.${f}`)))}</div>)}
        </Card>
      )}
    </form>
  );
}
