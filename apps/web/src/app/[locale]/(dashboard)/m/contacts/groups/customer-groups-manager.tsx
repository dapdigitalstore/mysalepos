'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface CustomerGroup {
  id: number;
  name: string;
  amount: number;
  price_calculation_type: string | null;
  selling_price_group_id: number | null;
  selling_price_group_name: string | null;
  contacts_count: number;
}

interface Option {
  id: number;
  label: string;
}

const schema = z
  .object({
    name: z.string().trim().min(1, 'required').max(191),
    priceCalculationType: z.enum(['percentage', 'selling_price_group']),
    amount: z.string(),
    sellingPriceGroupId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.priceCalculationType === 'percentage' && v.amount.trim() !== '') {
      const n = Number(v.amount);
      if (!Number.isFinite(n) || n < -100 || n > 100) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amountRange' });
    }
    if (v.priceCalculationType === 'selling_price_group' && !v.sellingPriceGroupId) {
      ctx.addIssue({ code: 'custom', path: ['sellingPriceGroupId'], message: 'required' });
    }
  });

type FormValues = z.infer<typeof schema>;

export function CustomerGroupsManager() {
  const t = useTranslations('customerGroups');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<CustomerGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CustomerGroup | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['customer-groups', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<CustomerGroup>>('/customer-groups', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/customer-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['customer-groups'] });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const columns: Column<CustomerGroup>[] = [
    { key: 'name', header: t('name'), sortBy: 'name' },
    {
      key: 'pricing',
      header: t('pricing'),
      cell: (g) => (g.price_calculation_type === 'selling_price_group' ? t('pricingGroup', { name: g.selling_price_group_name ?? '-' }) : t('pricingPercent', { amount: Number(g.amount) })),
    },
    { key: 'contacts', header: t('customers'), cell: (g) => g.contacts_count },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (g) => (
        <div className="flex gap-1">
          {can('customer.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(g)} aria-label={`${c('edit')} ${g.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('customer.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(g)} aria-label={`${c('delete')} ${g.name}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('customer.create') && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              {t('add')}
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(g) => g.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <GroupDialog group={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        body={deleting && deleting.contacts_count > 0 ? t('confirmDeleteUsed', { count: deleting.contacts_count }) : undefined}
      />
    </div>
  );
}

function GroupDialog({ group, onClose }: { group: CustomerGroup | 'new' | null; onClose: () => void }) {
  const t = useTranslations('customerGroups');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = group === 'new';
  const existing = group && group !== 'new' ? group : null;

  const priceGroups = useQuery({
    queryKey: ['customer-groups', 'price-groups'],
    queryFn: () => api<Option[]>('/customer-groups/price-groups'),
    enabled: !!group,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, watch, reset, formState } = form;
  const calc = watch('priceCalculationType');

  useEffect(() => {
    if (!group) return;
    reset(
      existing
        ? {
            name: existing.name,
            priceCalculationType: existing.price_calculation_type === 'selling_price_group' ? 'selling_price_group' : 'percentage',
            amount: existing.amount ? String(existing.amount) : '',
            sellingPriceGroupId: existing.selling_price_group_id ? String(existing.selling_price_group_id) : '',
          }
        : blank(),
    );
  }, [group, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body =
        v.priceCalculationType === 'selling_price_group'
          ? { name: v.name, priceCalculationType: v.priceCalculationType, sellingPriceGroupId: Number(v.sellingPriceGroupId) }
          : { name: v.name, priceCalculationType: v.priceCalculationType, amount: v.amount.trim() === '' ? 0 : Number(v.amount) };
      return isNew ? api('/customer-groups', { method: 'POST', body }) : api(`/customer-groups/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['customer-groups'] });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof FormValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (!m) return undefined;
    return m === 'required' ? c('required') : t(m as 'amountRange');
  };

  return (
    <Dialog open={!!group} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="name" error={err('name')} required>
          <Input id="name" {...register('name')} autoFocus />
        </Field>
        <Field label={t('calculationType')} htmlFor="priceCalculationType">
          <Select id="priceCalculationType" {...register('priceCalculationType')}>
            <option value="percentage">{t('typePercentage')}</option>
            <option value="selling_price_group">{t('typePriceGroup')}</option>
          </Select>
        </Field>
        {calc === 'percentage' ? (
          <Field label={t('percentage')} htmlFor="amount" error={err('amount')} hint={t('percentageHint')}>
            <Input id="amount" type="number" step="0.01" min="-100" max="100" inputMode="decimal" {...register('amount')} />
          </Field>
        ) : (
          <Field label={t('priceGroup')} htmlFor="sellingPriceGroupId" error={err('sellingPriceGroupId')} required>
            <Select id="sellingPriceGroupId" {...register('sellingPriceGroupId')}>
              <option value="">{t('choosePriceGroup')}</option>
              {(priceGroups.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {c('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function blank(): FormValues {
  return { name: '', priceCalculationType: 'percentage', amount: '', sellingPriceGroupId: '' };
}
