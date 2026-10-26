'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FormEvent, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';

interface Tax {
  id: number;
  name: string;
  amount: number;
  for_tax_group: boolean;
}
interface Group {
  id: number;
  name: string;
  amount: number;
  taxIds: number[];
  subTaxNames: string[];
}
interface TaxList {
  taxes: Tax[];
  groups: Group[];
}

type Target = { kind: 'tax'; row: Tax | null } | { kind: 'group'; row: Group | null };

export function TaxesManager() {
  const t = useTranslations('taxRates');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);

  const list = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<TaxList>('/tax-rates') });

  const remove = useMutation({
    mutationFn: (target: Target) => api(`/tax-rates/${target.kind === 'group' ? 'groups/' : ''}${target.row?.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['tax-rates'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const actions = (target: Target, label: string) => (
    <div className="flex gap-1">
      {can('tax_rate.update') && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(target)} aria-label={`${c('edit')} ${label}`}>
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      {can('tax_rate.delete') && (
        <Button variant="ghost" size="sm" onClick={() => setDeleting(target)} aria-label={`${c('delete')} ${label}`}>
          <Trash2 className="h-4 w-4 text-red-600" />
        </Button>
      )}
    </div>
  );

  const taxColumns: Column<Tax>[] = [
    { key: 'name', header: t('name') },
    { key: 'amount', header: t('rate'), cell: (x) => `${x.amount}%` },
    { key: 'forGroup', header: t('forGroupShort'), cell: (x) => (x.for_tax_group ? c('yes') : c('no')) },
    { key: 'actions', header: c('actions'), className: 'w-28', cell: (x) => actions({ kind: 'tax', row: x }, x.name) },
  ];
  const groupColumns: Column<Group>[] = [
    { key: 'name', header: t('name') },
    { key: 'amount', header: t('rate'), cell: (x) => `${x.amount}%` },
    { key: 'subs', header: t('includes'), cell: (x) => x.subTaxNames.join(', ') },
    { key: 'actions', header: c('actions'), className: 'w-28', cell: (x) => actions({ kind: 'group', row: x }, x.name) },
  ];

  const error = list.isError ? c('loadError') : null;

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title={t('title')}
          description={t('subtitle')}
          actions={can('tax_rate.create') && (
            <Button onClick={() => setEditing({ kind: 'tax', row: null })}>
              <Plus className="h-4 w-4" />
              {t('addTax')}
            </Button>
          )}
        />
        <DataTable columns={taxColumns} rows={list.data?.taxes} rowKey={(x) => x.id} loading={list.isLoading} error={error} onRetry={() => void list.refetch()} />
      </section>
      <section>
        <PageHeader
          title={t('groupsTitle')}
          description={t('groupsSubtitle')}
          actions={can('tax_rate.create') && (
            <Button onClick={() => setEditing({ kind: 'group', row: null })}>
              <Plus className="h-4 w-4" />
              {t('addGroup')}
            </Button>
          )}
        />
        <DataTable columns={groupColumns} rows={list.data?.groups} rowKey={(x) => x.id} loading={list.isLoading} error={error} onRetry={() => void list.refetch()} />
      </section>

      <TaxDialog target={editing?.kind === 'tax' ? editing : null} onClose={() => setEditing(null)} />
      <GroupDialog target={editing?.kind === 'group' ? editing : null} taxes={(list.data?.taxes ?? [])} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  );
}

function useSave(onClose: () => void) {
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  return {
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['tax-rates'] });
      onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  };
}

function TaxDialog({ target, onClose }: { target: { kind: 'tax'; row: Tax | null } | null; onClose: () => void }) {
  const t = useTranslations('taxRates');
  const c = useTranslations('common');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [forGroup, setForGroup] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!target) return;
    setName(target.row?.name ?? '');
    setAmount(target.row ? String(target.row.amount) : '');
    setForGroup(target.row?.for_tax_group ?? false);
    setTouched(false);
  }, [target]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), amount: Number(amount), forTaxGroup: forGroup };
      return target?.row ? api(`/tax-rates/${target.row.id}`, { method: 'PUT', body }) : api('/tax-rates', { method: 'POST', body });
    },
    ...useSave(onClose),
  });

  const amountInvalid = amount === '' || Number.isNaN(Number(amount)) || Number(amount) < 0 || Number(amount) > 100;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim() && !amountInvalid) save.mutate();
  };

  return (
    <Dialog open={!!target} onClose={onClose} title={target?.row ? t('editTax') : t('addTax')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="tax-name" required error={touched && !name.trim() ? c('required') : undefined}>
          <Input id="tax-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('rate')} htmlFor="tax-amount" required hint={t('rateHint')} error={touched && amountInvalid ? t('rateInvalid') : undefined}>
          <Input id="tax-amount" type="number" step="0.01" min="0" max="100" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Checkbox id="tax-for-group" label={t('forGroup')} checked={forGroup} onChange={(e) => setForGroup(e.target.checked)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{c('cancel')}</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? c('saving') : c('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function GroupDialog({ target, taxes, onClose }: { target: { kind: 'group'; row: Group | null } | null; taxes: Tax[]; onClose: () => void }) {
  const t = useTranslations('taxRates');
  const c = useTranslations('common');
  const [name, setName] = useState('');
  const [ids, setIds] = useState<number[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!target) return;
    setName(target.row?.name ?? '');
    setIds(target.row?.taxIds ?? []);
    setTouched(false);
  }, [target]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), taxIds: ids };
      return target?.row ? api(`/tax-rates/groups/${target.row.id}`, { method: 'PUT', body }) : api('/tax-rates/groups', { method: 'POST', body });
    },
    ...useSave(onClose),
  });

  const total = taxes.filter((x) => ids.includes(x.id)).reduce((s, x) => s + x.amount, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim() && ids.length > 0) save.mutate();
  };

  return (
    <Dialog open={!!target} onClose={onClose} title={target?.row ? t('editGroup') : t('addGroup')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('name')} htmlFor="group-name" required error={touched && !name.trim() ? c('required') : undefined}>
          <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">{t('subTaxes')}</legend>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {taxes.map((x) => (
              <Checkbox
                key={x.id}
                id={`sub-${x.id}`}
                label={`${x.name} (${x.amount}%)`}
                checked={ids.includes(x.id)}
                onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, x.id] : cur.filter((i) => i !== x.id)))}
              />
            ))}
          </div>
          {touched && ids.length === 0 && <p role="alert" className="mt-1 text-xs text-red-600">{t('pickOne')}</p>}
          <p className="mt-2 text-sm text-slate-600">{t('groupTotal', { total: Math.round(total * 10000) / 10000 })}</p>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>{c('cancel')}</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? c('saving') : c('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
