'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface VariationTemplate {
  id: number;
  name: string;
  values: { id: number; name: string }[];
  /** Product variations created from this template. */
  usage: number;
}

const schema = z.object({
  name: z.string().trim().min(1, 'required').max(191),
  values: z.array(z.object({ valueId: z.number().optional(), name: z.string().max(191) })),
});

type FormValues = z.infer<typeof schema>;

export function VariationTemplatesManager() {
  const t = useTranslations('variationTemplates');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<VariationTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<VariationTemplate | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['variation-templates', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<VariationTemplate>>('/variation-templates', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/variation-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['variation-templates'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const columns: Column<VariationTemplate>[] = [
    { key: 'name', header: t('name'), sortBy: 'name' },
    {
      key: 'values',
      header: t('values'),
      cell: (r) =>
        r.values.length === 0 ? (
          <span className="text-slate-400">{t('noValues')}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.values.map((v) => (
              <span key={v.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {v.name}
              </span>
            ))}
          </div>
        ),
    },
    { key: 'usage', header: t('usage'), cell: (r) => (r.usage > 0 ? t('usedBy', { count: r.usage }) : t('unused')) },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (r) => (
        <div className="flex gap-1">
          {can('product.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${c('edit')} ${r.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('product.delete') && r.usage === 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`${c('delete')} ${r.name}`}>
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
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <VariationDialog item={editing} onClose={() => setEditing(null)} />
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

function VariationDialog({ item, onClose }: { item: VariationTemplate | 'new' | null; onClose: () => void }) {
  const t = useTranslations('variationTemplates');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = item === 'new';
  const existing = item && item !== 'new' ? item : null;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, reset, control, formState, setError, clearErrors } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'values' });

  useEffect(() => {
    if (!item) return;
    reset(existing ? { name: existing.name, values: existing.values.map((v) => ({ valueId: v.id, name: v.name })) } : blank());
  }, [item, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        name: v.name,
        // Existing values are sent with their id so the API renames them instead of recreating them.
        values: v.values.filter((x) => x.name.trim() !== '').map((x) => ({ ...(x.valueId ? { id: x.valueId } : {}), name: x.name.trim() })),
      };
      return isNew ? api('/variation-templates', { method: 'POST', body }) : api(`/variation-templates/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['variation-templates'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const onSubmit = (v: FormValues) => {
    if (!v.values.some((x) => x.name.trim() !== '')) {
      setError('values', { type: 'custom', message: t('atLeastOne') });
      return;
    }
    clearErrors('values');
    save.mutate(v);
  };

  const valuesError = formState.errors.values?.message ?? formState.errors.values?.root?.message;

  return (
    <Dialog open={!!item} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="templateName" error={formState.errors.name ? c('required') : undefined} required>
          <Input id="templateName" {...register('name')} autoFocus />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            {t('valuesLabel')}
            <span className="ms-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          </legend>
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input {...register(`values.${i}.name`)} placeholder={t('valuePlaceholder')} aria-label={t('valueAria', { number: i + 1 })} />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={t('removeValue', { number: i + 1 })}>
                <X className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ name: '' })}>
            <Plus className="h-4 w-4" />
            {t('addValue')}
          </Button>
          {valuesError ? (
            <p role="alert" className="text-xs text-red-600">
              {valuesError}
            </p>
          ) : (
            <p className="text-xs text-slate-500">{t('valuesHint')}</p>
          )}
        </fieldset>

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
  return { name: '', values: [{ name: '' }] };
}
