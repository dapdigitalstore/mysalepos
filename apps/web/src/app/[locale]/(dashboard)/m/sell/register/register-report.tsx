'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye, Lock, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { useDateTimeFormatter } from './register-format';
import { useMethodLabel } from './register-summary';
import { REGISTER_KEYS, type Option, type PaymentMethodKey, type RegisterReportResponse, type RegisterReportRow } from './register-types';

const CUSTOM_METHODS: PaymentMethodKey[] = ['custom_pay_1', 'custom_pay_2', 'custom_pay_3', 'custom_pay_4', 'custom_pay_5', 'custom_pay_6', 'custom_pay_7'];

/** Register report (Laravel: Reports > Register report): every register with its sell money by payment method. Needs `register_report.view`. */
export function RegisterReport() {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const can = useCan();
  const label = useMethodLabel();

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'created_at', sortDir: 'desc' });
  const debounced = useDebounced(search);

  useEffect(() => setPage(1), [debounced, userId, status, locationId, startDate, endDate]);

  const query = { page, search: debounced, userId, status, locationId, startDate, endDate, ...sort };
  const list = useQuery({
    queryKey: [...REGISTER_KEYS.report, query],
    queryFn: () => api<RegisterReportResponse>('/cash-registers', { query }),
    placeholderData: (prev) => prev,
  });
  const users = useQuery({ queryKey: ['users', 'options'], queryFn: () => api<Option[]>('/users/options') });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });

  const fmt = useDateTimeFormatter(list.data?.timeZone ?? 'UTC');
  const totals = list.data?.totals;
  const filtered = Boolean(search || userId || status || locationId || startDate || endDate);
  const clear = () => {
    setSearch('');
    setUserId('');
    setStatus('');
    setLocationId('');
    setStartDate('');
    setEndDate('');
  };

  // Custom payment columns only appear when the filtered registers took money in them.
  const customShown = CUSTOM_METHODS.filter((m) => Number(totals?.methods[m] ?? 0) !== 0);
  const money = (v: string) => <span className="tabular-nums">{formatMoney(v)}</span>;

  const columns: Column<RegisterReportRow>[] = [
    { key: 'openTime', header: t('openTime'), sortBy: 'created_at', className: 'whitespace-nowrap', cell: (r) => fmt(r.openedAt) },
    { key: 'closeTime', header: t('closeTime'), sortBy: 'closed_at', className: 'whitespace-nowrap', cell: (r) => (r.status === 'close' ? fmt(r.closedAt) : <StatusBadge status="open" />) },
    { key: 'location', header: t('locationLabel'), cell: (r) => r.locationName ?? '-' },
    {
      key: 'user',
      header: t('user'),
      cell: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.userName || '-'}</div>
          {r.email && <div className="text-xs text-slate-500">{r.email}</div>}
        </div>
      ),
    },
    { key: 'card', header: `${label({ method: 'card' })} (${t('totalCardSlips')})`, className: 'text-end whitespace-nowrap', cell: (r) => <>{money(r.methods.card)} ({r.totalCardSlips})</> },
    { key: 'cheque', header: `${label({ method: 'cheque' })} (${t('totalCheques')})`, className: 'text-end whitespace-nowrap', cell: (r) => <>{money(r.methods.cheque)} ({r.totalCheques})</> },
    { key: 'cash', header: label({ method: 'cash' }), className: 'text-end whitespace-nowrap', cell: (r) => money(r.methods.cash) },
    { key: 'bank_transfer', header: label({ method: 'bank_transfer' }), className: 'text-end whitespace-nowrap', cell: (r) => money(r.methods.bank_transfer) },
    { key: 'advance', header: label({ method: 'advance' }), className: 'text-end whitespace-nowrap', cell: (r) => money(r.methods.advance) },
    ...customShown.map((m) => ({ key: m, header: label({ method: m }), className: 'text-end whitespace-nowrap', cell: (r: RegisterReportRow) => money(r.methods[m]) }) satisfies Column<RegisterReportRow>),
    { key: 'other', header: label({ method: 'other' }), className: 'text-end whitespace-nowrap', cell: (r) => money(r.methods.other) },
    { key: 'total', header: t('total'), className: 'text-end whitespace-nowrap font-semibold', cell: (r) => money(r.total) },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-24',
      cell: (r) => (
        <div className="flex gap-1">
          {can('view_cash_register') && (
            <Link href={`/m/sell/register/${r.id}`} aria-label={`${t('viewRegister')} #${r.id}`} className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-slate-600 hover:bg-slate-100">
              <Eye className="h-4 w-4" />
            </Link>
          )}
          {r.status === 'open' && can('close_cash_register') && (
            <Link href={`/m/sell/register/${r.id}/close`} aria-label={`${t('closeRegister')} #${r.id}`} className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-red-600 hover:bg-red-50">
              <Lock className="h-4 w-4" />
            </Link>
          )}
        </div>
      ),
    },
  ];

  return (
    <section aria-label={t('reportTitle')} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('reportTitle')}</h2>
        <p className="text-sm text-slate-500">{t('reportSubtitle')}</p>
      </div>

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative sm:col-span-2 lg:col-span-3">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
        </div>
        <Field label={t('filterUser')} htmlFor="rep-user">
          <Select id="rep-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('allUsers')}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filterLocation')} htmlFor="rep-location">
          <Select id="rep-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('allLocations')}</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('filterStatus')} htmlFor="rep-status">
          <Select id="rep-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allStatuses')}</option>
            <option value="open">{t('statusOpen')}</option>
            <option value="close">{t('statusClose')}</option>
          </Select>
        </Field>
        <Field label={t('dateFrom')} htmlFor="rep-from">
          <Input id="rep-from" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t('dateTo')} htmlFor="rep-to">
          <Input id="rep-to" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        {filtered && (
          <div className="flex items-end">
            <Button variant="outline" onClick={clear}>
              {t('clearFilters')}
            </Button>
          </div>
        )}
      </Card>

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
        emptyMessage={filtered ? t('noRegisters') : undefined}
      />

      {totals && list.data && list.data.meta.total > 0 && (
        <Card aria-label={t('reportTotals')}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('reportTotals')}</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {(['cash', 'card', 'cheque', 'bank_transfer', 'advance', ...customShown, 'other'] as PaymentMethodKey[]).map((m) => (
              <div key={m} className="flex justify-between gap-2">
                <dt className="text-slate-500">{label({ method: m })}</dt>
                <dd className="tabular-nums text-slate-800">{formatMoney(totals.methods[m])}</dd>
              </div>
            ))}
            <div className={cn('col-span-full flex justify-between gap-2 border-t border-slate-100 pt-2 text-base font-semibold')}>
              <dt>{t('total')}</dt>
              <dd className="tabular-nums">{formatMoney(totals.total)}</dd>
            </div>
          </dl>
        </Card>
      )}
    </section>
  );
}

export function StatusBadge({ status }: { status: 'open' | 'close' }) {
  const t = useTranslations('cashRegister');
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', status === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
      {status === 'open' ? t('statusOpen') : t('statusClose')}
    </span>
  );
}
