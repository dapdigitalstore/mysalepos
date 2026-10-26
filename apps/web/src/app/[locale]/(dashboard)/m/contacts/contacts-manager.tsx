'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api, ApiError, type Paginated } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { Badge } from './contact-badge';
import { ContactDialog } from './contact-dialog';
import { canAct, displayName, payTermText, type Contact, type ContactSide, type Option } from './contact-types';

export function ContactsManager({ side }: { side: ContactSide }) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const isCustomer = side === 'customer';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [groupId, setGroupId] = useState('');
  const [balance, setBalance] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  useEffect(() => setPage(1), [debounced, status, groupId, balance, side]);

  const query = { type: side, page, search: debounced, status, customerGroupId: isCustomer ? groupId : '', balance, ...sort };
  const list = useQuery({
    queryKey: ['contacts', query],
    queryFn: () => api<Paginated<Contact>>('/contacts', { query }),
    placeholderData: (prev) => prev,
  });

  const groups = useQuery({
    queryKey: ['customer-groups', 'options'],
    queryFn: () => api<Option[]>('/customer-groups/options'),
    enabled: isCustomer,
  });

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));

  const remove = useMutation({
    mutationFn: (id: number) => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (e) => {
      fail(e);
      setDeleting(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (id: number) => api(`/contacts/${id}/toggle-status`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('statusUpdated'));
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: fail,
  });

  const money = (v: string | undefined) => formatMoney(v ?? 0);
  const unit = (k: 'days' | 'months') => t(k);

  const columns: Column<Contact>[] = [
    { key: 'contact_id', header: t('contactId'), sortBy: 'contact_id', className: 'whitespace-nowrap' },
    {
      key: 'name',
      header: t('name'),
      sortBy: 'name',
      cell: (r) => (
        <div>
          <Link href={`/m/contacts/${r.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
            {displayName(r)}
          </Link>
          {r.supplier_business_name && r.supplier_business_name !== r.name && <div className="text-xs text-slate-500">{r.supplier_business_name}</div>}
          <div className="mt-0.5 flex flex-wrap gap-1">
            {r.is_default && <Badge tone="blue">{t('defaultBadge')}</Badge>}
            {r.contact_status === 'inactive' && <Badge tone="red">{c('inactive')}</Badge>}
            {r.type === 'both' && <Badge tone="slate">{t('typeBoth')}</Badge>}
          </div>
        </div>
      ),
    },
    { key: 'mobile', header: t('mobile'), sortBy: 'mobile', className: 'whitespace-nowrap' },
    ...(isCustomer ? [{ key: 'group', header: t('customerGroup'), cell: (r: Contact) => r.customer_group_name ?? '-' } satisfies Column<Contact>] : []),
    { key: 'payTerm', header: t('payTerm'), cell: (r) => payTermText(r, unit) || '-', className: 'whitespace-nowrap' },
    ...(isCustomer
      ? [{ key: 'credit_limit', header: t('creditLimit'), sortBy: 'credit_limit', cell: (r: Contact) => (r.credit_limit != null ? money(r.credit_limit) : '-'), className: 'whitespace-nowrap text-end' } satisfies Column<Contact>]
      : []),
    { key: 'opening', header: t('openingBalance'), cell: (r) => money(r.opening_balance_due), className: 'whitespace-nowrap text-end' },
    {
      key: 'due',
      header: isCustomer ? t('customerOwes') : t('weOwe'),
      cell: (r) => <span className={cn('font-medium', Number(r.due ?? 0) > 0 && 'text-red-600')}>{money(r.due)}</span>,
      className: 'whitespace-nowrap text-end',
    },
    { key: 'balance', header: t('advance'), sortBy: 'balance', cell: (r) => money(r.balance), className: 'whitespace-nowrap text-end' },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-40',
      cell: (r) => (
        <div className="flex gap-1">
          <Link
            href={`/m/contacts/${r.id}`}
            aria-label={`${t('view')} ${displayName(r)}`}
            className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-slate-600 hover:bg-slate-100"
          >
            <Eye className="h-4 w-4" />
          </Link>
          {canAct(can, 'update', r.type) && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`${c('edit')} ${displayName(r)}`}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle.mutate(r.id)}
                disabled={toggle.isPending || (r.is_default && r.contact_status === 'active')}
                aria-label={`${r.contact_status === 'active' ? t('deactivate') : t('activate')} ${displayName(r)}`}
                title={r.contact_status === 'active' ? t('deactivate') : t('activate')}
              >
                <Power className={cn('h-4 w-4', r.contact_status === 'active' ? 'text-emerald-600' : 'text-slate-400')} />
              </Button>
            </>
          )}
          {canAct(can, 'delete', r.type) && !r.is_default && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`${c('delete')} ${displayName(r)}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const canAdd = can(`${side}.create`, `${side}.view_own`);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t(isCustomer ? 'titleCustomers' : 'titleSuppliers')}
        description={t(isCustomer ? 'subtitleCustomers' : 'subtitleSuppliers')}
        actions={
          canAdd && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              {t(isCustomer ? 'addCustomer' : 'addSupplier')}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('filterStatus')} className="w-auto min-w-36">
          <option value="">{t('allStatuses')}</option>
          <option value="active">{c('active')}</option>
          <option value="inactive">{c('inactive')}</option>
        </Select>
        {isCustomer && (
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={t('filterGroup')} className="w-auto min-w-40">
            <option value="">{t('allGroups')}</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        )}
        <Select value={balance} onChange={(e) => setBalance(e.target.value)} aria-label={t('filterBalance')} className="w-auto min-w-44">
          <option value="">{t('allBalances')}</option>
          <option value="due">{t(isCustomer ? 'balanceDueCustomer' : 'balanceDueSupplier')}</option>
          <option value="advance">{t('balanceAdvance')}</option>
          <option value="opening">{t('balanceOpening')}</option>
        </Select>
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

      <ContactDialog contact={editing} defaultSide={side} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={t('confirmDeleteTitle')}
        body={t('confirmDeleteBody', { name: deleting ? displayName(deleting) : '' })}
      />
    </div>
  );
}
