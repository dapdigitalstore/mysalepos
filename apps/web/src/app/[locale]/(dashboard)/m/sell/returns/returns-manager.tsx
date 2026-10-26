'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { customerLabel, formatDateTime, type Option, type ReturnList, type ReturnRow } from './return-types';
import { StatusBadge } from './status-badge';

/** Laravel: Sell > List sell return. */
export function ReturnsManager() {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const locale = useLocale();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'transaction_date', sortDir: 'desc' });
  const debounced = useDebounced(search);
  const [deleting, setDeleting] = useState<ReturnRow | null>(null);

  useEffect(() => setPage(1), [debounced, locationId, customerId, paymentStatus, startDate, endDate]);

  const query = { page, search: debounced, locationId, customerId, paymentStatus, startDate, endDate, ...sort };
  const list = useQuery({
    queryKey: ['sell-returns', query],
    queryFn: () => api<ReturnList>('/sell-returns', { query }),
    placeholderData: (prev) => prev,
  });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });
  const customers = useQuery({ queryKey: ['contacts', 'options', 'customer'], queryFn: () => api<Option[]>('/contacts/options', { query: { type: 'customer', limit: 500 } }) });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/sell-returns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['sell-returns'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const hasFilters = !!(search || locationId || customerId || paymentStatus || startDate || endDate);
  const clear = () => {
    setSearch('');
    setLocationId('');
    setCustomerId('');
    setPaymentStatus('');
    setStartDate('');
    setEndDate('');
  };

  const columns: Column<ReturnRow>[] = [
    { key: 'transaction_date', header: t('colDate'), sortBy: 'transaction_date', cell: (r) => formatDateTime(r.transactionDate, r.timeZone, locale), className: 'whitespace-nowrap' },
    {
      key: 'invoice_no',
      header: t('colInvoice'),
      sortBy: 'invoice_no',
      cell: (r) => (
        <Link href={`/m/sell/returns/${r.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
          {r.invoiceNo ?? `#${r.id}`}
        </Link>
      ),
      className: 'whitespace-nowrap',
    },
    { key: 'parent', header: t('colParentSale'), cell: (r) => r.parentSaleInvoiceNo ?? '-', className: 'whitespace-nowrap' },
    { key: 'customer', header: t('colCustomer'), cell: (r) => customerLabel(r) || t('walkIn') },
    { key: 'location', header: t('colLocation'), cell: (r) => r.locationName ?? '-' },
    { key: 'final_total', header: t('colTotal'), sortBy: 'final_total', cell: (r) => formatMoney(r.finalTotal), className: 'whitespace-nowrap text-end' },
    { key: 'payment_status', header: t('colStatus'), sortBy: 'payment_status', cell: (r) => <StatusBadge status={r.paymentStatus} /> },
    { key: 'paid', header: t('colPaid'), cell: (r) => formatMoney(r.amountPaid), className: 'whitespace-nowrap text-end' },
    {
      key: 'due',
      header: t('colDue'),
      cell: (r) => <span className={cn(Number(r.paymentDue) > 0 && 'font-medium text-red-600')}>{formatMoney(r.paymentDue)}</span>,
      className: 'whitespace-nowrap text-end',
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-44',
      cell: (r) => (
        <div className="flex gap-1">
          <Link href={`/m/sell/returns/${r.id}`} aria-label={`${t('view')} ${r.invoiceNo ?? r.id}`} className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-slate-600 hover:bg-slate-100">
            <Eye className="h-4 w-4" />
          </Link>
          <Link href={`/m/sell/returns/${r.id}?print=1`} aria-label={`${t('print')} ${r.invoiceNo ?? r.id}`} className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-slate-600 hover:bg-slate-100">
            <Printer className="h-4 w-4" />
          </Link>
          {r.parentSaleId && (
            <Link href={`/m/sell/returns/new?saleId=${r.parentSaleId}`} aria-label={`${t('edit')} ${r.invoiceNo ?? r.id}`} className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-slate-600 hover:bg-slate-100">
              <Pencil className="h-4 w-4" />
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`${t('delete')} ${r.invoiceNo ?? r.id}`}>
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('access_sell_return', 'access_own_sell_return') && (
            <Link href="/m/sell/returns/new" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-dark">
              <Plus className="h-4 w-4" />
              {t('newReturn')}
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
        </div>
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label={t('filterLocation')} className="w-auto min-w-40">
          <option value="">{t('allLocations')}</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label={t('filterCustomer')} className="w-auto min-w-40">
          <option value="">{t('allCustomers')}</option>
          {(customers.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} aria-label={t('filterStatus')} className="w-auto min-w-40">
          <option value="">{t('allStatuses')}</option>
          <option value="paid">{t('statusPaid')}</option>
          <option value="partial">{t('statusPartial')}</option>
          <option value="due">{t('statusDue')}</option>
        </Select>
        <Input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} aria-label={t('startDate')} className="w-auto" />
        <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} aria-label={t('endDate')} className="w-auto" />
        {hasFilters && (
          <Button variant="ghost" onClick={clear}>
            {t('clearFilters')}
          </Button>
        )}
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

      {list.data && list.data.meta.total > 0 && (
        <Card className="mt-4 grid gap-3 sm:grid-cols-3">
          <Total label={t('totalReturns')} value={formatMoney(list.data.totals.finalTotal)} />
          <Total label={t('totalPaid')} value={formatMoney(list.data.totals.amountPaid)} />
          <Total label={t('totalDue')} value={formatMoney(list.data.totals.paymentDue)} tone={Number(list.data.totals.paymentDue) > 0 ? 'text-red-600' : undefined} />
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        busy={remove.isPending}
        title={t('deleteTitle')}
        body={t('deleteBody')}
      />
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold text-slate-900', tone)}>{value}</p>
    </div>
  );
}
