'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan, useSession } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { useRouter } from '@/i18n/routing';
import { api, ApiError, type Paginated } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface UserRow {
  id: number;
  username: string | null;
  fullName: string;
  email: string | null;
  allowLogin: boolean;
  status: 'active' | 'inactive' | 'terminated';
  roleId: number | null;
  roleName: string | null;
}

const STATUS_STYLE: Record<UserRow['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
  terminated: 'bg-red-50 text-red-700',
};

export function UsersManager() {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const can = useCan();
  const me = useSession();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'first_name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [deleting, setDeleting] = useState<UserRow | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['users', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<UserRow>>('/users', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
    enabled: can('user.view', 'user.create'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const roleLabel = (name: string | null) => (name === 'Admin' ? t('roleAdmin') : name === 'Cashier' ? t('roleCashier') : (name ?? ''));
  const statusLabel = (s: UserRow['status']) => (s === 'active' ? t('statusActive') : s === 'inactive' ? t('statusInactive') : t('statusTerminated'));

  const columns: Column<UserRow>[] = [
    {
      key: 'username',
      header: t('colUsername'),
      sortBy: 'username',
      cell: (u) => (
        <span className="flex flex-wrap items-center gap-2">
          {u.username ?? '-'}
          {!u.allowLogin && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t('loginNotAllowed')}</span>}
        </span>
      ),
    },
    { key: 'fullName', header: t('colName'), sortBy: 'first_name' },
    { key: 'email', header: t('colEmail'), sortBy: 'email', cell: (u) => u.email ?? '-' },
    { key: 'role', header: t('colRole'), cell: (u) => roleLabel(u.roleName) || '-' },
    {
      key: 'status',
      header: t('colStatus'),
      cell: (u) => <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[u.status])}>{statusLabel(u.status)}</span>,
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (u) => (
        <div className="flex gap-1">
          {can('user.update') && (
            <Button variant="ghost" size="sm" onClick={() => router.push(`/m/users/list/${u.id}`)} aria-label={`${c('edit')} ${u.fullName}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('user.delete') && u.id !== me.id && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(u)} aria-label={`${c('delete')} ${u.fullName}`}>
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
            <Button onClick={() => router.push('/m/users/list/new')}>
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
