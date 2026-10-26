'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { emptyPrices, recalc, toApiPrices, trimNumber, type PriceField, type PriceFields } from './_lib/pricing';
import type { FormMeta, Option, ProductDetail, SubUnit, TaxOption, TemplateOption, UnitOption } from './_lib/types';
import { ComboEditor, comboLinesTotal, type ComboLine } from './combo-editor';
import { PriceInputs } from './price-fields';
import { newKey, VariationEditor, type VarGroup } from './variation-editor';

const BARCODES = ['C128', 'C39', 'EAN13', 'EAN8', 'UPCA', 'UPCE'] as const;

const schema = z.object({
  name: z.string().trim().min(1, 'required').max(191),
  type: z.enum(['single', 'variable', 'combo']),
  sku: z.string().trim().max(191),
  barcodeType: z.enum(BARCODES),
  unitId: z.string().min(1, 'required'),
  brandId: z.string(),
  categoryId: z.string(),
  subCategoryId: z.string(),
  warrantyId: z.string(),
  description: z.string().max(20000),
  weight: z.string().max(191),
  notForSelling: z.boolean(),
  enableSrNo: z.boolean(),
  enableStock: z.boolean(),
  alertQuantity: z.string(),
  expiryPeriod: z.string(),
  expiryPeriodType: z.enum(['days', 'months']),
  taxId: z.string(),
  taxType: z.enum(['inclusive', 'exclusive']),
  skuType: z.enum(['with_out_variation', 'with_variation']),
});
type FormValues = z.infer<typeof schema>;

const blank = (): FormValues => ({
  name: '',
  type: 'single',
  sku: '',
  barcodeType: 'C128',
  unitId: '',
  brandId: '',
  categoryId: '',
  subCategoryId: '',
  warrantyId: '',
  description: '',
  weight: '',
  notForSelling: false,
  enableSrNo: false,
  enableStock: true,
  alertQuantity: '',
  expiryPeriod: '',
  expiryPeriodType: 'months',
  taxId: '',
  taxType: 'exclusive',
  skuType: 'with_out_variation',
});

const numOrNull = (v: string) => (v ? Number(v) : null);

/** Add / edit product. One page with sections: basic info, stock and locations, pricing, variations or components. */
export function ProductForm({ productId }: { productId?: number }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const isEdit = productId !== undefined;

  const meta = useQuery({ queryKey: ['products', 'form-meta'], queryFn: () => api<FormMeta>('/products/form-meta') });
  const units = useQuery({ queryKey: ['units', 'options'], queryFn: () => api<UnitOption[]>('/units/options') });
  const brands = useQuery({ queryKey: ['brands', 'options'], queryFn: () => api<Option[]>('/brands/options') });
  const categories = useQuery({ queryKey: ['categories', 'options', 0], queryFn: () => api<Option[]>('/categories/options', { query: { parentId: 0 } }) });
  const taxes = useQuery({ queryKey: ['tax-rates', 'options'], queryFn: () => api<TaxOption[]>('/tax-rates/options') });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });
  const warranties = useQuery({ queryKey: ['warranties', 'options'], queryFn: () => api<Option[]>('/warranties/options') });
  const templates = useQuery({ queryKey: ['variation-templates', 'options'], queryFn: () => api<TemplateOption[]>('/variation-templates/options') });
  const detail = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => api<ProductDetail>(`/products/${productId}`),
    enabled: isEdit,
    staleTime: 0,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, watch, reset, setValue, clearErrors, formState } = form;
  const type = watch('type');
  const enableStock = watch('enableStock');
  const taxType = watch('taxType');
  const taxId = watch('taxId');
  const categoryId = watch('categoryId');
  const unitId = watch('unitId');
  const sku = watch('sku');

  const [prices, setPrices] = useState<PriceFields>(emptyPrices('0'));
  const [combo, setCombo] = useState<ComboLine[]>([]);
  const [groups, setGroups] = useState<VarGroup[]>([]);
  const [locationIds, setLocationIds] = useState<number[]>([]);
  const [subUnitIds, setSubUnitIds] = useState<number[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [skuTaken, setSkuTaken] = useState(false);
  const initialised = useRef(false);

  const defaultProfit = String(meta.data?.defaultProfitPercent ?? 0);
  const taxPercent = Number(taxes.data?.find((x) => String(x.id) === taxId)?.amount ?? 0);
  const selectedUnit = units.data?.find((u) => String(u.id) === unitId);

  const subCategories = useQuery({
    queryKey: ['categories', 'options', categoryId],
    queryFn: () => api<Option[]>('/categories/options', { query: { parentId: categoryId } }),
    enabled: !!categoryId,
  });
  const subUnits = useQuery({
    queryKey: ['products', 'sub-units', unitId],
    queryFn: () => api<SubUnit[]>('/products/sub-units', { query: { unitId } }),
    enabled: !!unitId && !!meta.data?.enableSubUnits,
  });

  // Fresh product: default profit percent, and a single permitted location is pre-selected.
  useEffect(() => {
    if (isEdit || initialised.current || !meta.data || !locations.data) return;
    initialised.current = true;
    setPrices(emptyPrices(String(meta.data.defaultProfitPercent)));
    const permitted = meta.data.permittedLocationIds;
    const visible = locations.data.filter((l) => permitted === null || permitted.includes(l.id));
    if (visible.length === 1) setLocationIds([visible[0].id]);
  }, [isEdit, meta.data, locations.data]);

  // Existing product: fill the form once.
  useEffect(() => {
    const p = detail.data;
    if (!p || initialised.current) return;
    initialised.current = true;
    reset({
      name: p.name,
      type: p.type,
      sku: p.sku,
      barcodeType: (BARCODES as readonly string[]).includes(p.barcode_type ?? '') ? (p.barcode_type as FormValues['barcodeType']) : 'C128',
      unitId: p.unit_id ? String(p.unit_id) : '',
      brandId: p.brand_id ? String(p.brand_id) : '',
      categoryId: p.category_id ? String(p.category_id) : '',
      subCategoryId: p.sub_category_id ? String(p.sub_category_id) : '',
      warrantyId: p.warranty_id ? String(p.warranty_id) : '',
      description: p.product_description ?? '',
      weight: p.weight ?? '',
      notForSelling: p.not_for_selling,
      enableSrNo: p.enable_sr_no,
      enableStock: p.enable_stock,
      alertQuantity: trimNumber(p.alert_quantity),
      expiryPeriod: trimNumber(p.expiry_period),
      expiryPeriodType: p.expiry_period_type ?? 'months',
      taxId: p.tax ? String(p.tax) : '',
      taxType: p.tax_type,
      skuType: 'with_out_variation',
    });
    setLocationIds(p.location_ids);
    setSubUnitIds(p.sub_unit_ids);
    const toPrices = (v: { default_purchase_price: string | null; dpp_inc_tax: string | null; profit_percent: string | null; default_sell_price: string | null; sell_price_inc_tax: string | null }): PriceFields => ({
      purchaseExc: trimNumber(v.default_purchase_price),
      purchaseInc: trimNumber(v.dpp_inc_tax),
      profit: trimNumber(v.profit_percent) || '0',
      sellExc: trimNumber(v.default_sell_price),
      sellInc: trimNumber(v.sell_price_inc_tax),
    });
    if (p.type === 'variable') {
      setGroups(
        p.product_variations.map((g) => ({
          key: newKey(),
          id: g.id,
          templateId: g.variation_template_id ? String(g.variation_template_id) : '',
          name: g.name,
          rows: g.variations.map((v) => ({ key: newKey(), id: v.id, name: v.name, subSku: v.sub_sku ?? '', valueId: v.variation_value_id ?? undefined, prices: toPrices(v) })),
        })),
      );
    } else {
      const only = p.product_variations[0]?.variations[0];
      if (only) setPrices(toPrices(only));
    }
    if (p.type === 'combo') {
      void Promise.all(
        p.combo_items.map(async (i) => {
          let unitsOfItem: SubUnit[] = [];
          if (i.product_unit_id) {
            try {
              unitsOfItem = await api<SubUnit[]>('/products/sub-units', { query: { unitId: i.product_unit_id } });
            } catch {
              unitsOfItem = [];
            }
          }
          const line: ComboLine = {
            variationId: i.variation_id,
            label: i.variation_name ? `${i.product_name} - ${i.variation_name}` : i.product_name,
            quantity: trimNumber(i.quantity),
            unitId: i.unit_id,
            units: unitsOfItem,
            purchasePrice: i.purchase_price ?? '0',
          };
          return line;
        }),
      ).then(setCombo);
    }
  }, [detail.data, reset]);

  // A changed tax rate recalculates the including-tax prices everywhere.
  const onTaxChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pct = Number(taxes.data?.find((x) => String(x.id) === e.target.value)?.amount ?? 0);
    setPrices((p) => recalc(p, 'tax', pct));
    setGroups((gs) => gs.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, prices: recalc(r.prices, 'tax', pct) })) })));
  };

  const onPriceChange = (field: PriceField, raw: string) => setPrices((p) => recalc({ ...p, [field]: raw }, field, taxPercent));

  const onComboChange = (lines: ComboLine[]) => {
    setCombo(lines);
    setPrices((p) => recalc({ ...p, purchaseExc: String(comboLinesTotal(lines)) }, 'purchaseExc', taxPercent));
  };

  const checkSku = async () => {
    const value = sku.trim();
    setSkuTaken(false);
    if (!value) return;
    try {
      const res = await api<{ available: boolean }>('/products/check-sku', { query: { sku: value, productId } });
      setSkuTaken(!res.available);
    } catch {
      // The server checks again on save.
    }
  };

  const save = useMutation({
    mutationFn: async ({ values, next }: { values: FormValues; next: 'detail' | 'opening' }) => {
      const body = buildBody(values);
      const saved = isEdit ? await api<ProductDetail>(`/products/${productId}`, { method: 'PUT', body }) : await api<ProductDetail>('/products', { method: 'POST', body });
      return { saved, next };
    },
    onSuccess: ({ saved, next }) => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      router.push(next === 'opening' ? `/m/products/${saved.id}/opening-stock` : `/m/products/${saved.id}`);
    },
    onError: (e) => setFormError(e instanceof ApiError && e.messages.length ? e.messages.join(' ') : c('somethingWrong')),
  });

  function buildBody(v: FormValues) {
    const common = {
      name: v.name.trim(),
      type: v.type,
      sku: v.sku.trim() || undefined,
      barcodeType: v.barcodeType,
      unitId: Number(v.unitId),
      subUnitIds: meta.data?.enableSubUnits ? subUnitIds : undefined,
      brandId: numOrNull(v.brandId),
      categoryId: numOrNull(v.categoryId),
      subCategoryId: v.categoryId ? numOrNull(v.subCategoryId) : null,
      taxId: numOrNull(v.taxId),
      taxType: v.taxType,
      enableStock: v.enableStock,
      alertQuantity: v.enableStock && v.alertQuantity !== '' ? v.alertQuantity : null,
      expiryPeriod: v.enableStock && v.expiryPeriod !== '' ? v.expiryPeriod : null,
      expiryPeriodType: v.enableStock && v.expiryPeriod !== '' ? v.expiryPeriodType : null,
      enableSrNo: v.enableSrNo,
      weight: v.weight.trim() || null,
      description: v.description.trim() || null,
      warrantyId: numOrNull(v.warrantyId),
      notForSelling: v.notForSelling,
      locationIds,
    };
    if (v.type === 'variable') {
      return {
        ...common,
        skuType: v.skuType,
        variationGroups: groups.map((g) => ({
          ...(g.id ? { id: g.id } : {}),
          name: g.name.trim(),
          ...(g.templateId ? { variationTemplateId: Number(g.templateId) } : {}),
          variations: g.rows.map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: r.name.trim(),
            ...(r.subSku.trim() ? { subSku: r.subSku.trim() } : {}),
            ...(r.valueId ? { variationValueId: r.valueId } : {}),
            ...toApiPrices(r.prices),
          })),
        })),
      };
    }
    if (v.type === 'combo') {
      return {
        ...common,
        prices: toApiPrices(prices),
        comboItems: combo.map((l) => ({ variationId: l.variationId, quantity: l.quantity, ...(l.unitId ? { unitId: l.unitId } : {}) })),
      };
    }
    return { ...common, prices: toApiPrices(prices) };
  }

  /** Checks the parts that live outside react-hook-form. Returns an error message or null. */
  function validateExtras(v: FormValues): string | null {
    if (v.type === 'combo') {
      if (combo.length === 0) return t('errors.comboEmpty');
      if (combo.some((l) => !(Number(l.quantity) > 0))) return t('errors.comboQuantity');
    }
    if (v.type === 'variable') {
      if (groups.length === 0) return t('errors.variationsEmpty');
      for (const g of groups) {
        if (!g.name.trim()) return t('errors.groupName');
        if (g.rows.length === 0) return t('errors.groupValues', { name: g.name });
        if (g.rows.some((r) => !r.name.trim())) return t('errors.valueName', { name: g.name });
        const names = g.rows.map((r) => r.name.trim().toLowerCase());
        if (new Set(names).size !== names.length) return t('errors.valueDuplicate', { name: g.name });
      }
    }
    if (v.enableStock && v.expiryPeriod !== '' && !(Number(v.expiryPeriod) > 0)) return t('errors.expiry');
    return null;
  }

  const submit = (next: 'detail' | 'opening') =>
    handleSubmit((values) => {
      setFormError(null);
      if (skuTaken) {
        setFormError(t('errors.skuTaken'));
        return;
      }
      const problem = validateExtras(values);
      if (problem) {
        setFormError(problem);
        return;
      }
      save.mutate({ values, next });
    }, () => setFormError(t('errors.fixFields')));

  const err = (k: keyof FormValues) => (formState.errors[k] ? c('required') : undefined);
  const toggleId = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const visibleLocations = (locations.data ?? []).filter((l) => !meta.data || meta.data.permittedLocationIds === null || meta.data.permittedLocationIds.includes(l.id));
  const comboPurchase = comboLinesTotal(combo);

  // ---- loading / error states
  const loadingBasics = meta.isLoading || units.isLoading || taxes.isLoading || (isEdit && detail.isLoading);
  const failedBasics = meta.isError || units.isError || taxes.isError || (isEdit && detail.isError);
  if (failedBasics) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{c('loadError')}</span>
          <Button variant="outline" size="sm" onClick={() => void Promise.all([meta.refetch(), units.refetch(), taxes.refetch(), detail.refetch()])}>
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }
  if (loadingBasics) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label={c('loading')}>
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
            <div className="mt-4 h-24 animate-pulse rounded bg-slate-100" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={submit('detail')} noValidate className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={isEdit ? t('form.editTitle') : t('form.addTitle')} description={isEdit ? detail.data?.name : t('form.addSubtitle')} />

      {/* ------------------------------------------------ basic info */}
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{t('form.basic')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.name')} htmlFor="name" error={err('name')} required>
            <Input id="name" {...register('name')} autoFocus={!isEdit} />
          </Field>
          <Field label={t('form.type')} htmlFor="type" hint={isEdit ? t('form.typeLocked') : undefined} required>
            <Select id="type" {...register('type')} disabled={isEdit}>
              {(['single', 'variable', 'combo'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`types.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('form.sku')}
            htmlFor="sku"
            error={skuTaken ? t('errors.skuTaken') : undefined}
            hint={t('form.skuHint', { prefix: meta.data?.skuPrefix ?? '' })}
          >
            <Input id="sku" {...register('sku', { onBlur: () => void checkSku(), onChange: () => setSkuTaken(false) })} />
          </Field>
          <Field label={t('form.barcodeType')} htmlFor="barcodeType">
            <Select id="barcodeType" {...register('barcodeType')}>
              {BARCODES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.unit')} htmlFor="unitId" error={err('unitId')} required>
            <Select
              id="unitId"
              {...register('unitId', {
                onChange: () => {
                  setSubUnitIds([]);
                },
              })}
            >
              <option value="">{t('form.choose')}</option>
              {(units.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          {meta.data?.enableBrand && (
            <Field label={t('form.brand')} htmlFor="brandId">
              <Select id="brandId" {...register('brandId')}>
                <option value="">{t('form.none')}</option>
                {(brands.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {meta.data?.enableCategory && (
            <Field label={t('form.category')} htmlFor="categoryId">
              <Select
                id="categoryId"
                {...register('categoryId', {
                  onChange: () => setValue('subCategoryId', ''),
                })}
              >
                <option value="">{t('form.none')}</option>
                {(categories.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {meta.data?.enableCategory && meta.data.enableSubCategory && (
            <Field label={t('form.subCategory')} htmlFor="subCategoryId">
              <Select id="subCategoryId" {...register('subCategoryId')} disabled={!categoryId}>
                <option value="">{t('form.none')}</option>
                {(subCategories.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('form.warranty')} htmlFor="warrantyId">
            <Select id="warrantyId" {...register('warrantyId')}>
              <option value="">{t('form.none')}</option>
              {(warranties.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.weight')} htmlFor="weight">
            <Input id="weight" {...register('weight')} />
          </Field>
        </div>

        {meta.data?.enableSubUnits && (subUnits.data?.length ?? 0) > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">{t('form.subUnits')}</legend>
            <p className="text-xs text-slate-500">{t('form.subUnitsHint')}</p>
            <div className="flex flex-wrap gap-4">
              {subUnits.data?.map((s) => (
                <Checkbox key={s.id} id={`su-${s.id}`} label={s.id === Number(unitId) ? s.label : `${s.label} (x${Number(s.multiplier)})`} checked={subUnitIds.includes(s.id)} onChange={() => setSubUnitIds((l) => toggleId(l, s.id))} />
              ))}
            </div>
          </fieldset>
        )}

        <Field label={t('form.description')} htmlFor="description">
          <Textarea id="description" {...register('description')} />
        </Field>
        <div className="flex flex-wrap gap-6">
          <Checkbox id="notForSelling" label={t('form.notForSelling')} {...register('notForSelling')} />
          <Checkbox id="enableSrNo" label={t('form.enableSrNo')} {...register('enableSrNo')} />
        </div>
      </Card>

      {/* ------------------------------------------------ stock & locations */}
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{t('form.stockSection')}</h2>
        <Checkbox id="enableStock" label={t('form.enableStock')} {...register('enableStock')} />
        {enableStock && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('form.alertQuantity')} htmlFor="alertQuantity" hint={selectedUnit ? selectedUnit.label : undefined}>
              <Input id="alertQuantity" type="number" step="any" min="0" inputMode="decimal" {...register('alertQuantity')} />
            </Field>
            {meta.data?.enableProductExpiry && (
              <>
                <Field label={t('form.expiryPeriod')} htmlFor="expiryPeriod">
                  <Input id="expiryPeriod" type="number" step="any" min="0" inputMode="decimal" {...register('expiryPeriod')} />
                </Field>
                <Field label={t('form.expiryType')} htmlFor="expiryPeriodType">
                  <Select id="expiryPeriodType" {...register('expiryPeriodType')}>
                    <option value="days">{t('form.days')}</option>
                    <option value="months">{t('form.months')}</option>
                  </Select>
                </Field>
              </>
            )}
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">{t('form.locations')}</legend>
          <p className="text-xs text-slate-500">{t('form.locationsHint')}</p>
          {locations.isLoading && <p className="text-sm text-slate-500">{c('loading')}</p>}
          {locations.isError && <p className="text-sm text-red-700">{c('loadError')}</p>}
          <div className="flex flex-wrap gap-4">
            {visibleLocations.map((l) => (
              <Checkbox key={l.id} id={`loc-${l.id}`} label={l.label} checked={locationIds.includes(l.id)} onChange={() => setLocationIds((cur) => toggleId(cur, l.id))} />
            ))}
          </div>
        </fieldset>
      </Card>

      {/* ------------------------------------------------ pricing */}
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{t('form.pricing')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.tax')} htmlFor="taxId">
            <Select id="taxId" {...register('taxId', { onChange: onTaxChange })}>
              <option value="">{t('form.noTax')}</option>
              {(taxes.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.taxType')} htmlFor="taxType" hint={t('form.taxTypeHint')}>
            <Select id="taxType" {...register('taxType')}>
              <option value="exclusive">{t('form.exclusive')}</option>
              <option value="inclusive">{t('form.inclusive')}</option>
            </Select>
          </Field>
        </div>

        {type === 'variable' ? (
          <>
            <h3 className="text-sm font-semibold text-slate-800">{t('form.variationsTitle')}</h3>
            {!isEdit && (
              <Field label={t('variations.skuType')} htmlFor="skuType" className="max-w-sm">
                <Select id="skuType" {...register('skuType')}>
                  <option value="with_out_variation">{t('variations.skuNumber')}</option>
                  <option value="with_variation">{t('variations.skuValue')}</option>
                </Select>
              </Field>
            )}
            <VariationEditor groups={groups} onChange={setGroups} templates={templates.data ?? []} taxPercent={taxPercent} defaultProfit={defaultProfit} />
            {templates.isError && <p className="text-sm text-red-700">{c('loadError')}</p>}
          </>
        ) : (
          <>
            {type === 'combo' && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">{t('form.comboTitle')}</h3>
                <ComboEditor lines={combo} onChange={onComboChange} />
                <p className="text-sm text-slate-600">
                  {t('combo.purchaseTotal')}: <strong>{formatMoney(comboPurchase)}</strong>
                </p>
              </div>
            )}
            <PriceInputs value={prices} onChange={onPriceChange} taxType={taxType} purchaseReadOnly={type === 'combo'} />
          </>
        )}
      </Card>

      {formError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      {Object.keys(formState.errors).length > 0 && !formError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" onClick={() => clearErrors()}>
          {t('errors.fixFields')}
        </div>
      )}

      <div className="sticky bottom-0 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-card backdrop-blur">
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={isEdit ? `/m/products/${productId}` : '/m/products'} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {c('cancel')}
          </Link>
          {enableStock && can('product.opening_stock') && (
            <Button type="button" variant="outline" disabled={save.isPending} onClick={() => void submit('opening')()}>
              {t('form.saveAndStock')}
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
