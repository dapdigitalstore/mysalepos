'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { useRouter } from '@/i18n/routing';
import { api, ApiError, type Paginated } from '@/lib/client-api';

interface RoleRow {
  id: number;
  name: string;
  isDefault: boolean;
  isAdmin: boolean;
  isServiceStaff: boolean;
  locked: boolean;
  userCount: number;
}

export function RolesManager() {
  const t = useTranslations('roles');
  const c = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const debounced = useDebounced(search);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: ['roles', { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<RoleRow>>('/roles', { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const roleLabel = (r: RoleRow) => (r.name === 'Admin' ? t('roleAdmin') : r.name === 'Cashier' ? t('roleCashier') : r.name);

  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      header: t('colName'),
      sortBy: 'name',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          {roleLabel(r)}
          {r.locked && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t('defaultBadge')}</span>}
        </span>
      ),
    },
    { key: 'userCount', header: t('colUsers') },
    {
      key: 'actions',
      header: t('colActions'),
      className: 'w-32',
      cell: (r) => (
        <div className="flex gap-1">
          {r.locked ? (
            <Button variant="ghost" size="sm" onClick={() => router.push(`/m/users/roles/${r.id}`)} aria-label={`${t('view')} ${roleLabel(r)}`}>
              <Eye className="h-4 w-4" />
            </Button>
          ) : (
            <>
              {can('roles.update') && (
                <Button variant="ghost" size="sm" onClick={() => router.push(`/m/users/roles/${r.id}`)} aria-label={`${c('edit')} ${roleLabel(r)}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {can('roles.delete') && (
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`${c('delete')} ${roleLabel(r)}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              )}
            </>
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
          can('roles.create') && (
            <Button onClick={() => router.push('/m/users/roles/new')}>
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
