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
import { Checkbox, Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface Unit {
  id: number;
  actual_name: string;
  short_name: string;
  allow_decimal: boolean;
  base_unit_id: number | null;
  base_unit_multiplier: string | null;
  base_unit_name: string | null;
}

interface Option {
  id: number;
  label: string;
}

const schema = z
  .object({
    actualName: z.string().trim().min(1, 'required').max(191),
    shortName: z.string().trim().min(1, 'required').max(191),
    allowDecimal: z.enum(['1', '0']),
    defineBase: z.boolean(),
    baseUnitId: z.string().optional(),
    baseUnitMultiplier: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.defineBase) return;
    if (!v.baseUnitId) ctx.addIssue({ code: 'custom', path: ['baseUnitId'], message: 'required' });
    const m = Number(v.baseUnitMultiplier);
    if (!v.baseUnitMultiplier || !(m > 0)) ctx.addIssue({ code: 'custom', path: ['baseUnitMultiplier'], message: 'required' });
  });

type FormValues = z.infer<typeof schema>;

export function UnitsManager() {
  const t = useTranslations('units');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'actual_name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<Unit | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['units', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<Unit>>('/units', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/units/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const columns: Column<Unit>[] = [
    { key: 'actual_name', header: t('name'), sortBy: 'actual_name' },
    { key: 'short_name', header: t('shortName'), sortBy: 'short_name' },
    { key: 'allow_decimal', header: t('allowDecimal'), cell: (u) => (u.allow_decimal ? c('yes') : c('no')) },
    {
      key: 'base',
      header: t('baseUnit'),
      cell: (u) =>
        u.base_unit_name
          ? t('definition', { unit: u.actual_name, multiplier: Number(u.base_unit_multiplier), base: u.base_unit_name })
          : t('noBase'),
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (u) => (
        <div className="flex gap-1">
          {can('unit.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label={`${c('edit')} ${u.actual_name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('unit.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(u)} aria-label={`${c('delete')} ${u.actual_name}`}>
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
          can('unit.create') && (
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
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />

      <UnitDialog unit={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}

function UnitDialog({ unit, onClose }: { unit: Unit | 'new' | null; onClose: () => void }) {
  const t = useTranslations('units');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = unit === 'new';
  const existing = unit && unit !== 'new' ? unit : null;

  const options = useQuery({
    queryKey: ['units', 'options'],
    queryFn: () => api<Option[]>('/units/options'),
    enabled: !!unit,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, watch, reset, formState } = form;
  const defineBase = watch('defineBase');

  useEffect(() => {
    if (!unit) return;
    reset(
      existing
        ? {
            actualName: existing.actual_name,
            shortName: existing.short_name,
            allowDecimal: existing.allow_decimal ? '1' : '0',
            defineBase: existing.base_unit_id != null,
            baseUnitId: existing.base_unit_id ? String(existing.base_unit_id) : '',
            baseUnitMultiplier: existing.base_unit_multiplier ? String(Number(existing.base_unit_multiplier)) : '',
          }
        : blank(),
    );
  }, [unit, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        actualName: v.actualName,
        shortName: v.shortName,
        allowDecimal: v.allowDecimal === '1',
        ...(v.defineBase ? { baseUnitId: Number(v.baseUnitId), baseUnitMultiplier: Number(v.baseUnitMultiplier) } : {}),
      };
      return isNew ? api('/units', { method: 'POST', body }) : api(`/units/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['units'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof FormValues) => (formState.errors[k] ? c('required') : undefined);
  // A unit cannot be its own base unit.
  const baseChoices = (options.data ?? []).filter((o) => o.id !== existing?.id);

  return (
    <Dialog open={!!unit} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('name')} htmlFor="actualName" error={err('actualName')} required>
            <Input id="actualName" {...register('actualName')} autoFocus />
          </Field>
          <Field label={t('shortName')} htmlFor="shortName" error={err('shortName')} required>
            <Input id="shortName" {...register('shortName')} />
          </Field>
        </div>
        <Field label={t('allowDecimal')} htmlFor="allowDecimal">
          <Select id="allowDecimal" {...register('allowDecimal')}>
            <option value="0">{c('no')}</option>
            <option value="1">{c('yes')}</option>
          </Select>
        </Field>
        <Checkbox id="defineBase" label={t('defineBase')} {...register('defineBase')} />
        {defineBase && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('baseUnit')} htmlFor="baseUnitId" error={err('baseUnitId')} required>
              <Select id="baseUnitId" {...register('baseUnitId')}>
                <option value="">{t('chooseBase')}</option>
                {baseChoices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('multiplier')} htmlFor="baseUnitMultiplier" error={err('baseUnitMultiplier')} hint={t('multiplierHint')} required>
              <Input id="baseUnitMultiplier" type="number" step="0.0001" min="0" inputMode="decimal" {...register('baseUnitMultiplier')} />
            </Field>
          </div>
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
  return { actualName: '', shortName: '', allowDecimal: '0', defineBase: false, baseUnitId: '', baseUnitMultiplier: '' };
}
