'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
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
import { Field, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface PriceGroup {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
}

const schema = z.object({
  name: z.string().trim().min(1, 'required').max(191),
  description: z.string().max(5000).optional(),
});

type FormValues = z.infer<typeof schema>;

export function SellingPriceGroupsManager() {
  const t = useTranslations('sellingPriceGroups');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<PriceGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PriceGroup | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['selling-price-groups', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<PriceGroup>>('/selling-price-groups', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const onError = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));

  const remove = useMutation({
    mutationFn: (id: number) => api(`/selling-price-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['selling-price-groups'] });
    },
    onError: (e) => {
      onError(e);
      setDeleting(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (id: number) => api(`/selling-price-groups/${id}/toggle-active`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['selling-price-groups'] });
    },
    onError,
  });

  const columns: Column<PriceGroup>[] = [
    { key: 'name', header: t('name'), sortBy: 'name' },
    { key: 'description', header: t('description'), cell: (g) => <span className="line-clamp-2 text-slate-600">{g.description ?? ''}</span> },
    {
      key: 'is_active',
      header: t('status'),
      sortBy: 'is_active',
      cell: (g) => (
        <span className={g.is_active ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700' : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'}>
          {g.is_active ? c('active') : c('inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-36',
      cell: (g) => (
        <div className="flex gap-1">
          {can('product.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(g)} aria-label={`${c('edit')} ${g.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('product.create') && (
            <Button
              variant="ghost"
              size="sm"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate(g.id)}
              aria-label={g.is_active ? t('deactivateAria', { name: g.name }) : t('activateAria', { name: g.name })}
              title={g.is_active ? t('deactivate') : t('activate')}
            >
              <Power className={g.is_active ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-slate-400'} />
            </Button>
          )}
          {can('product.create') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(g)} aria-label={`${c('delete')} ${g.name}`}>
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
        rowKey={(g) => g.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <PriceGroupDialog item={editing} onClose={() => setEditing(null)} />
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

function PriceGroupDialog({ item, onClose }: { item: PriceGroup | 'new' | null; onClose: () => void }) {
  const t = useTranslations('sellingPriceGroups');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = item === 'new';
  const existing = item && item !== 'new' ? item : null;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', description: '' } });
  const { register, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (!item) return;
    reset(existing ? { name: existing.name, description: existing.description ?? '' } : { name: '', description: '' });
  }, [item, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { name: v.name, description: v.description ?? '' };
      return isNew ? api('/selling-price-groups', { method: 'POST', body }) : api(`/selling-price-groups/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['selling-price-groups'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  return (
    <Dialog open={!!item} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="groupName" error={formState.errors.name ? c('required') : undefined} required>
          <Input id="groupName" {...register('name')} autoFocus />
        </Field>
        <Field label={t('description')} htmlFor="groupDescription">
          <Textarea id="groupDescription" rows={3} {...register('description')} />
        </Field>
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
