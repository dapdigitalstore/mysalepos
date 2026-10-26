'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface Location {
  id: number;
  location_id: string | null;
  name: string;
  landmark: string | null;
  country: string;
  state: string;
  city: string;
  zip_code: string;
  invoice_scheme_id: number;
  invoice_layout_id: number;
  sale_invoice_scheme_id: number | null;
  sale_invoice_layout_id: number | null;
  selling_price_group_id: number | null;
  mobile: string | null;
  alternate_number: string | null;
  email: string | null;
  website: string | null;
  custom_field1: string | null;
  custom_field2: string | null;
  custom_field3: string | null;
  custom_field4: string | null;
  is_active: boolean;
}

interface Option {
  id: number;
  label: string;
}

const text = z.string().trim();
const schema = z.object({
  name: text.min(1).max(256),
  locationId: text.max(191),
  landmark: text,
  country: text.min(1).max(100),
  state: text.min(1).max(100),
  city: text.min(1).max(100),
  zipCode: text.min(1).max(7),
  invoiceSchemeId: z.string().min(1),
  invoiceLayoutId: z.string().min(1),
  saleInvoiceSchemeId: z.string(),
  saleInvoiceLayoutId: z.string(),
  sellingPriceGroupId: z.string(),
  mobile: text,
  alternateNumber: text,
  email: z.string().trim().refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v)),
  website: text,
  customField1: text,
  customField2: text,
  customField3: text,
  customField4: text,
});
type Values = z.infer<typeof schema>;

const blank: Values = {
  name: '', locationId: '', landmark: '', country: '', state: '', city: '', zipCode: '',
  invoiceSchemeId: '', invoiceLayoutId: '', saleInvoiceSchemeId: '', saleInvoiceLayoutId: '', sellingPriceGroupId: '',
  mobile: '', alternateNumber: '', email: '', website: '', customField1: '', customField2: '', customField3: '', customField4: '',
};

const str = (v: string | number | null) => (v == null ? '' : String(v));
const optNum = (v: string) => (v ? Number(v) : null);
const optText = (v: string) => (v ? v : null);

export function LocationsManager() {
  const t = useTranslations('locations');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  const list = useQuery({ queryKey: ['locations'], queryFn: () => api<Location[]>('/business-locations') });

  const toggle = useMutation({
    mutationFn: (id: number) => api(`/business-locations/${id}/toggle-active`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const allowed = can('business_settings.access');
  const columns: Column<Location>[] = [
    { key: 'location_id', header: t('code') },
    { key: 'name', header: t('name'), cell: (l) => <span className="font-medium text-slate-900">{l.name}</span> },
    { key: 'city', header: t('city') },
    { key: 'mobile', header: t('mobile'), cell: (l) => l.mobile ?? '' },
    {
      key: 'status',
      header: t('status'),
      cell: (l) => (
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', l.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600')}>
          {l.is_active ? c('active') : c('inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (l) =>
        allowed && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(l)} aria-label={`${c('edit')} ${l.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggle.mutate(l.id)} disabled={toggle.isPending} aria-label={`${l.is_active ? t('deactivate') : t('activate')} ${l.name}`}>
              <Power className={cn('h-4 w-4', l.is_active ? 'text-emerald-600' : 'text-slate-400')} />
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={allowed && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        )}
      />
      <DataTable columns={columns} rows={list.data} rowKey={(l) => l.id} loading={list.isLoading} error={list.isError ? c('loadError') : null} onRetry={() => void list.refetch()} />
      <LocationDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function LocationDialog({ target, onClose }: { target: Location | 'new' | null; onClose: () => void }) {
  const t = useTranslations('locations');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = target === 'new';
  const existing = target && target !== 'new' ? target : null;

  const opt = (path: string) => useQuery({ queryKey: ['options', path], queryFn: () => api<Option[]>(path), enabled: !!target });
  const schemes = opt('/invoice-schemes/options');
  const layouts = opt('/invoice-layouts/options');
  const groups = opt('/selling-price-groups/options');

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank });
  const { register, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (!target) return;
    reset(
      existing
        ? {
            name: existing.name, locationId: str(existing.location_id), landmark: str(existing.landmark), country: existing.country, state: existing.state,
            city: existing.city, zipCode: existing.zip_code.trim(), invoiceSchemeId: str(existing.invoice_scheme_id), invoiceLayoutId: str(existing.invoice_layout_id),
            saleInvoiceSchemeId: str(existing.sale_invoice_scheme_id), saleInvoiceLayoutId: str(existing.sale_invoice_layout_id),
            sellingPriceGroupId: str(existing.selling_price_group_id), mobile: str(existing.mobile), alternateNumber: str(existing.alternate_number),
            email: str(existing.email), website: str(existing.website), customField1: str(existing.custom_field1), customField2: str(existing.custom_field2),
            customField3: str(existing.custom_field3), customField4: str(existing.custom_field4),
          }
        : blank,
    );
  }, [target, existing, reset]);

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name, locationId: optText(v.locationId), landmark: optText(v.landmark), country: v.country, state: v.state, city: v.city, zipCode: v.zipCode,
        invoiceSchemeId: Number(v.invoiceSchemeId), invoiceLayoutId: Number(v.invoiceLayoutId),
        saleInvoiceSchemeId: optNum(v.saleInvoiceSchemeId), saleInvoiceLayoutId: optNum(v.saleInvoiceLayoutId), sellingPriceGroupId: optNum(v.sellingPriceGroupId),
        mobile: optText(v.mobile), alternateNumber: optText(v.alternateNumber), email: optText(v.email), website: optText(v.website),
        customField1: optText(v.customField1), customField2: optText(v.customField2), customField3: optText(v.customField3), customField4: optText(v.customField4),
      };
      return isNew ? api('/business-locations', { method: 'POST', body }) : api(`/business-locations/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['locations'] });
      void qc.invalidateQueries({ queryKey: ['options', '/business-locations/options'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof Values) => (formState.errors[k] ? c('required') : undefined);
  const select = (id: keyof Values, label: string, options: Option[] | undefined, required = false, empty = '') => (
    <Field label={label} htmlFor={id} error={required ? err(id) : undefined} required={required}>
      <Select id={id} {...register(id)}>
        <option value="">{empty}</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </Select>
    </Field>
  );
  const input = (id: keyof Values, label: string, required = false, extra?: { hint?: string; maxLength?: number; type?: string }) => (
    <Field label={label} htmlFor={id} error={err(id)} required={required} hint={extra?.hint}>
      <Input id={id} type={extra?.type} maxLength={extra?.maxLength} {...register(id)} />
    </Field>
  );

  return (
    <Dialog open={!!target} onClose={onClose} title={isNew ? t('add') : t('edit')} className="max-w-3xl">
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('name', t('name'), true)}
          {input('locationId', t('code'), false, { hint: t('codeHint') })}
          {input('landmark', t('landmark'))}
          {input('city', t('city'), true)}
          {input('state', t('state'), true)}
          {input('country', t('country'), true)}
          {input('zipCode', t('zip'), true, { maxLength: 7 })}
          {input('mobile', t('mobile'))}
          {input('alternateNumber', t('alternateNumber'))}
          {input('email', t('email'), false, { type: 'email' })}
          {input('website', t('website'))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {select('invoiceSchemeId', t('invoiceScheme'), schemes.data, true, t('choose'))}
          {select('invoiceLayoutId', t('invoiceLayout'), layouts.data, true, t('choose'))}
          {select('saleInvoiceSchemeId', t('saleInvoiceScheme'), schemes.data, false, t('sameAsDefault'))}
          {select('saleInvoiceLayoutId', t('saleInvoiceLayout'), layouts.data, false, t('sameAsDefault'))}
          {select('sellingPriceGroupId', t('priceGroup'), groups.data, false, t('none'))}
        </div>
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">{t('customFields')}</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {input('customField1', t('customField', { n: 1 }))}
            {input('customField2', t('customField', { n: 2 }))}
            {input('customField3', t('customField', { n: 3 }))}
            {input('customField4', t('customField', { n: 4 }))}
          </div>
        </details>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{c('cancel')}</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? c('saving') : c('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
