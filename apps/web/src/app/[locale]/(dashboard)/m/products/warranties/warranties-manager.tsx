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
import { Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

type DurationType = 'days' | 'months' | 'years';

interface Warranty {
  id: number;
  name: string;
  description: string | null;
  duration: number;
  duration_type: DurationType;
}

const schema = z.object({
  name: z.string().trim().min(1, 'required').max(191),
  description: z.string().max(5000).optional(),
  duration: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, 'invalid'),
  durationType: z.enum(['days', 'months', 'years']),
});

type FormValues = z.infer<typeof schema>;

export function WarrantiesManager() {
  const t = useTranslations('warranties');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<Warranty | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Warranty | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['warranties', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<Warranty>>('/warranties', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/warranties/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['warranties'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const durationText = (w: Warranty) => {
    if (w.duration_type === 'days') return t('daysCount', { count: w.duration });
    if (w.duration_type === 'months') return t('monthsCount', { count: w.duration });
    return t('yearsCount', { count: w.duration });
  };

  const columns: Column<Warranty>[] = [
    { key: 'name', header: t('name'), sortBy: 'name' },
    { key: 'description', header: t('description'), cell: (w) => <span className="line-clamp-2 text-slate-600">{w.description ?? ''}</span> },
    { key: 'duration', header: t('duration'), sortBy: 'duration', cell: durationText },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (w) => (
        <div className="flex gap-1">
          {can('product.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(w)} aria-label={`${c('edit')} ${w.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('product.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(w)} aria-label={`${c('delete')} ${w.name}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('product.create') && (
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
        rowKey={(w) => w.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <WarrantyDialog item={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={remove.isPending}
        body={t('deleteBody')}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function WarrantyDialog({ item, onClose }: { item: Warranty | 'new' | null; onClose: () => void }) {
  const t = useTranslations('warranties');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = item === 'new';
  const existing = item && item !== 'new' ? item : null;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (!item) return;
    reset(
      existing
        ? { name: existing.name, description: existing.description ?? '', duration: String(existing.duration), durationType: existing.duration_type }
        : blank(),
    );
  }, [item, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { name: v.name, description: v.description ?? '', duration: Number(v.duration), durationType: v.durationType };
      return isNew ? api('/warranties', { method: 'POST', body }) : api(`/warranties/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['warranties'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  return (
    <Dialog open={!!item} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="warrantyName" error={formState.errors.name ? c('required') : undefined} required>
          <Input id="warrantyName" {...register('name')} autoFocus />
        </Field>
        <Field label={t('description')} htmlFor="warrantyDescription">
          <Textarea id="warrantyDescription" rows={3} {...register('description')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('duration')} htmlFor="warrantyDuration" error={formState.errors.duration ? t('durationInvalid') : undefined} required>
            <Input id="warrantyDuration" type="number" min="1" step="1" inputMode="numeric" {...register('duration')} />
          </Field>
          <Field label={t('durationType')} htmlFor="warrantyDurationType" required>
            <Select id="warrantyDurationType" {...register('durationType')}>
              <option value="days">{t('days')}</option>
              <option value="months">{t('months')}</option>
              <option value="years">{t('years')}</option>
            </Select>
          </Field>
        </div>
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
  return { name: '', description: '', duration: '', durationType: 'months' };
}
