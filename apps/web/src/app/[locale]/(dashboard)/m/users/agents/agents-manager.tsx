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
import { Field, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface Agent {
  id: number;
  surname: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  contactNo: string;
  address: string;
  cmmsnPercent: string;
}

const schema = z
  .object({
    surname: z.string().trim().max(10),
    firstName: z.string().trim().min(1, 'required').max(191),
    lastName: z.string().trim().max(191),
    email: z.string().trim().max(191),
    contactNo: z.string().trim().max(15),
    address: z.string().trim().max(2000),
    cmmsnPercent: z.string().trim().min(1, 'required'),
  })
  .superRefine((v, ctx) => {
    if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'vEmail' });
    const n = Number(v.cmmsnPercent);
    if (v.cmmsnPercent && !(Number.isFinite(n) && n >= 0 && n <= 99.99)) ctx.addIssue({ code: 'custom', path: ['cmmsnPercent'], message: 'vPercent' });
  });

type FormValues = z.infer<typeof schema>;

export function AgentsManager() {
  const t = useTranslations('commissionAgents');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'first_name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['commission-agents', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<Agent>>('/commission-agents', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/commission-agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['commission-agents'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const columns: Column<Agent>[] = [
    { key: 'fullName', header: t('colName'), sortBy: 'first_name' },
    { key: 'email', header: t('colEmail'), sortBy: 'email', cell: (a) => a.email || '-' },
    { key: 'contactNo', header: t('colContact'), sortBy: 'contact_no', cell: (a) => a.contactNo || '-' },
    { key: 'address', header: t('colAddress'), cell: (a) => <span className="line-clamp-2 max-w-xs">{a.address || '-'}</span> },
    { key: 'cmmsnPercent', header: t('colPercent'), sortBy: 'cmmsn_percent', cell: (a) => `${a.cmmsnPercent}%` },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (a) => (
        <div className="flex gap-1">
          {can('user.update') && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(a)} aria-label={`${c('edit')} ${a.fullName}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('user.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(a)} aria-label={`${c('delete')} ${a.fullName}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('user.create') && (
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
        rowKey={(a) => a.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />
      <AgentDialog agent={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={remove.isPending}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function blank(): FormValues {
  return { surname: '', firstName: '', lastName: '', email: '', contactNo: '', address: '', cmmsnPercent: '' };
}

function AgentDialog({ agent, onClose }: { agent: Agent | 'new' | null; onClose: () => void }) {
  const t = useTranslations('commissionAgents');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = agent === 'new';
  const existing = agent && agent !== 'new' ? agent : null;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });
  const { register, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (!agent) return;
    reset(
      existing
        ? {
            surname: existing.surname,
            firstName: existing.firstName,
            lastName: existing.lastName,
            email: existing.email,
            contactNo: existing.contactNo,
            address: existing.address,
            cmmsnPercent: String(Number(existing.cmmsnPercent)),
          }
        : blank(),
    );
  }, [agent, existing, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { ...v, cmmsnPercent: Number(v.cmmsnPercent) };
      return isNew ? api('/commission-agents', { method: 'POST', body }) : api(`/commission-agents/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['commission-agents'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof FormValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (m === 'vEmail' || m === 'vPercent') return t(m);
    return formState.errors[k] ? c('required') : undefined;
  };

  return (
    <Dialog open={!!agent} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label={t('surname')} htmlFor="surname" error={err('surname')} className="sm:col-span-2">
            <Input id="surname" placeholder={t('surnamePlaceholder')} {...register('surname')} />
          </Field>
          <Field label={t('firstName')} htmlFor="firstName" error={err('firstName')} required className="sm:col-span-4">
            <Input id="firstName" {...register('firstName')} autoFocus />
          </Field>
          <Field label={t('lastName')} htmlFor="lastName" error={err('lastName')} className="sm:col-span-6">
            <Input id="lastName" {...register('lastName')} />
          </Field>
          <Field label={t('email')} htmlFor="email" error={err('email')} className="sm:col-span-3">
            <Input id="email" type="email" {...register('email')} />
          </Field>
          <Field label={t('contactNo')} htmlFor="contactNo" error={err('contactNo')} className="sm:col-span-3">
            <Input id="contactNo" {...register('contactNo')} />
          </Field>
          <Field label={t('address')} htmlFor="address" error={err('address')} className="sm:col-span-6">
            <Textarea id="address" rows={3} {...register('address')} />
          </Field>
          <Field label={t('cmmsnPercent')} htmlFor="cmmsnPercent" error={err('cmmsnPercent')} required className="sm:col-span-6">
            <Input id="cmmsnPercent" inputMode="decimal" {...register('cmmsnPercent')} />
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
