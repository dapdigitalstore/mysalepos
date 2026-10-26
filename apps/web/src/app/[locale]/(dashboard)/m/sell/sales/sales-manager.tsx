'use client';

import { useQuery } from '@tanstack/react-query';
import { CreditCard, Copy, Eye, FileText, ListChecks, Pencil, Plus, Printer, Receipt, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { ActionMenu, type MenuItem } from './_lib/action-menu';
import { PaymentBadge, ShippingBadge } from './_lib/badges';
import { DateRangeFilter, NO_RANGE, type RangeValue } from './_lib/date-range-filter';
import { PaymentDialog, usePaymentMethods } from './_lib/payment-dialog';
import { customerLabel, SHIPPING_STATUSES, type SaleList, type SaleRow } from './_lib/sale-types';
import { useBusiness, useCommissionAgentOptions, useCustomerOptions, useDateFormat, useLocationOptions, useUserOptions } from './_lib/use-business';
import { useSaleActions } from './_lib/use-sale-actions';

interface Filters {
  locationId: string;
  contactId: string;
  paymentStatus: string;
  shippingStatus: string;
  createdBy: string;
  commissionAgentId: string;
  paymentMethod: string;
  source: '' | 'pos' | 'direct';
}

const NO_FILTERS: Filters = { locationId: '', contactId: '', paymentStatus: '', shippingStatus: '', createdBy: '', commissionAgentId: '', paymentMethod: '', source: '' };

const LINK_BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium';

/** Laravel: Sell > All sales (sell/index.blade.php + SellController@index). */
export function SalesManager() {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const can = useCan();
  const biz = useBusiness();
  const fmt = useDateFormat();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [range, setRange] = useState<RangeValue>(NO_RANGE);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'transaction_date', sortDir: 'desc' });
  const [deleting, setDeleting] = useState<SaleRow | null>(null);
  const [paying, setPaying] = useState<SaleRow | null>(null);
  const debounced = useDebounced(search);

  useEffect(() => setPage(1), [debounced, filters, range.startDate, range.endDate]);

  const query = {
    page,
    search: debounced,
    locationId: filters.locationId,
    contactId: filters.contactId,
    paymentStatus: filters.paymentStatus,
    shippingStatus: filters.shippingStatus,
    createdBy: filters.createdBy,
    commissionAgentId: filters.commissionAgentId,
    paymentMethod: filters.paymentMethod,
    isDirectSale: filters.source === '' ? undefined : filters.source === 'direct',
    startDate: range.startDate,
    endDate: range.endDate,
    ...sort,
  };
  const list = useQuery({
    queryKey: ['sales', 'list', query],
    queryFn: () => api<SaleList>('/sales', { query }),
    placeholderData: (prev) => prev,
    enabled: biz.ready,
  });

  const locations = useLocationOptions();
  const customers = useCustomerOptions();
  const users = useUserOptions();
  const agents = useCommissionAgentOptions(true);
  const methods = usePaymentMethods(true);
  const canShipFilter = can('access_shipping', 'access_own_shipping');

  const actions = useSaleActions({ afterDelete: () => setDeleting(null), canListDrafts: can('list_drafts') });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const hasFilters = !!(search || range.startDate || range.endDate || Object.values(filters).some(Boolean));
  const clear = () => {
    setSearch('');
    setFilters(NO_FILTERS);
    setRange(NO_RANGE);
  };

  const printHref = (r: SaleRow, format: 'receipt' | 'invoice') => `/m/sell/sales/${r.id}/print?format=${format}&auto=1`;

  const menuFor = (r: SaleRow): MenuItem[] => {
    return [
      { key: 'view', label: t('actView'), icon: <Eye className="h-4 w-4" />, href: `/m/sell/sales/${r.id}` },
      { key: 'edit', label: t('actEdit'), icon: <Pencil className="h-4 w-4" />, href: `/m/sell/sales/${r.id}/edit`, show: can('sell.update', 'direct_sell.access') && !r.hasReturn },
      { key: 'pay', label: t('actAddPayment'), icon: <CreditCard className="h-4 w-4" />, onSelect: () => setPaying(r), show: can('sell.payments') && r.paymentStatus !== 'paid' && !r.isSuspend },
      { key: 'payments', label: t('actViewPayments'), icon: <ListChecks className="h-4 w-4" />, href: `/m/sell/sales/${r.id}#payments`, show: can('sell.payments') },
      { key: 'receipt', label: t('actPrintReceipt'), icon: <Receipt className="h-4 w-4" />, href: printHref(r, 'receipt'), newTab: true, show: can('print_invoice') },
      { key: 'invoice', label: t('actPrintInvoice'), icon: <Printer className="h-4 w-4" />, href: printHref(r, 'invoice'), newTab: true, show: can('print_invoice') },
      { key: 'return', label: t('actReturn'), icon: <RotateCcw className="h-4 w-4" />, href: `/m/sell/returns/new?saleId=${r.id}`, show: can('access_sell_return', 'access_own_sell_return') && !r.isSuspend },
      { key: 'duplicate', label: t('actDuplicate'), icon: <Copy className="h-4 w-4" />, onSelect: () => actions.duplicate.mutate(r.id), show: can('sell.create') },
      { key: 'delete', label: t('actDelete'), icon: <Trash2 className="h-4 w-4" />, onSelect: () => setDeleting(r), danger: true, show: can('sell.delete', 'direct_sell.delete') },
    ];
  };

  const columns: Column<SaleRow>[] = [
    { key: 'transaction_date', header: t('colDate'), sortBy: 'transaction_date', cell: (r) => fmt.dateTime(r.transactionDate), className: 'whitespace-nowrap' },
    {
      key: 'invoice_no',
      header: t('colInvoice'),
      sortBy: 'invoice_no',
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/m/sell/sales/${r.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
            {r.invoiceNo ?? `#${r.id}`}
          </Link>
          {r.isSuspend && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">{t('kindSuspended')}</span>}
          {r.hasReturn && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{t('hasReturn')}</span>}
        </div>
      ),
      className: 'whitespace-nowrap',
    },
    {
      key: 'customer',
      header: t('colCustomer'),
      sortBy: 'customer',
      cell: (r) => (
        <div>
          <p className="text-slate-900">{customerLabel(r) || t('walkIn')}</p>
          {r.contactMobile && <p className="text-xs text-slate-500">{r.contactMobile}</p>}
        </div>
      ),
    },
    { key: 'location', header: t('colLocation'), sortBy: 'location', cell: (r) => r.locationName ?? '-' },
    { key: 'payment_status', header: t('colPayment'), sortBy: 'payment_status', cell: (r) => <PaymentBadge status={r.displayPaymentStatus ?? r.paymentStatus} /> },
    { key: 'final_total', header: t('colTotal'), sortBy: 'final_total', cell: (r) => formatMoney(r.finalTotal), className: 'whitespace-nowrap text-end' },
    { key: 'total_paid', header: t('colPaid'), sortBy: 'total_paid', cell: (r) => formatMoney(r.totalPaid), className: 'whitespace-nowrap text-end' },
    {
      key: 'total_remaining',
      header: t('colDue'),
      sortBy: 'total_remaining',
      cell: (r) => <span className={cn(Number(r.totalRemaining) > 0 && 'font-medium text-red-600')}>{formatMoney(r.totalRemaining)}</span>,
      className: 'whitespace-nowrap text-end',
    },
    ...(canShipFilter ? [{ key: 'shipping_status', header: t('colShipping'), sortBy: 'shipping_status', cell: (r: SaleRow) => <ShippingBadge status={r.shippingStatus} /> }] : []),
    { key: 'added_by', header: t('colAddedBy'), sortBy: 'added_by', cell: (r) => r.addedBy ?? '-', className: 'whitespace-nowrap' },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-16 text-end',
      cell: (r) => <ActionMenu label={r.invoiceNo ?? `#${r.id}`} items={menuFor(r)} />,
    },
  ];

  const totals = list.data?.meta.totals;
  const filterGrid = cn('grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4', showFilters ? 'grid' : 'hidden md:grid');

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            {can('direct_sell.access') && (
              <Link href="/m/sell/new" className={cn(LINK_BUTTON, 'bg-primary text-white hover:bg-primary-dark')}>
                <Plus className="h-4 w-4" />
                {t('addSale')}
              </Link>
            )}
            {can('sell.create') && (
              <Link href="/m/sell/pos" className={cn(LINK_BUTTON, 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                <FileText className="h-4 w-4" />
                {t('openPos')}
              </Link>
            )}
          </>
        }
      />

      <Card className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
          </div>
          <Button variant="outline" className="md:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="sales-filters">
            <SlidersHorizontal className="h-4 w-4" />
            {t('filters')}
          </Button>
          {hasFilters && (
            <Button variant="ghost" onClick={clear}>
              {t('clearFilters')}
            </Button>
          )}
        </div>

        <div id="sales-filters" className={filterGrid}>
          <Field label={t('filterLocation')} htmlFor="f-location">
            <Select id="f-location" value={filters.locationId} onChange={(e) => setFilter('locationId', e.target.value)}>
              <option value="">{t('allLocations')}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filterCustomer')} htmlFor="f-customer">
            <Select id="f-customer" value={filters.contactId} onChange={(e) => setFilter('contactId', e.target.value)}>
              <option value="">{t('allCustomers')}</option>
              {(customers.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filterPayment')} htmlFor="f-payment">
            <Select id="f-payment" value={filters.paymentStatus} onChange={(e) => setFilter('paymentStatus', e.target.value)}>
              <option value="">{t('allStatuses')}</option>
              <option value="paid">{t('payPaid')}</option>
              <option value="due">{t('payDue')}</option>
              <option value="partial">{t('payPartial')}</option>
              <option value="overdue">{t('payOverdue')}</option>
            </Select>
          </Field>
          <Field label={t('filterMethod')} htmlFor="f-method">
            <Select id="f-method" value={filters.paymentMethod} onChange={(e) => setFilter('paymentMethod', e.target.value)}>
              <option value="">{t('allMethods')}</option>
              {methods.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <DateRangeFilter value={range} timeZone={biz.timeZone} onChange={setRange} idPrefix="f-date" />
          <Field label={t('filterSource')} htmlFor="f-source">
            <Select id="f-source" value={filters.source} onChange={(e) => setFilter('source', e.target.value as Filters['source'])}>
              <option value="">{t('sourceAll')}</option>
              <option value="pos">{t('sourcePos')}</option>
              <option value="direct">{t('sourceDirect')}</option>
            </Select>
          </Field>
          <Field label={t('filterCreatedBy')} htmlFor="f-created">
            <Select id="f-created" value={filters.createdBy} onChange={(e) => setFilter('createdBy', e.target.value)}>
              <option value="">{t('allUsers')}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          {(agents.data ?? []).length > 0 && (
            <Field label={t('filterAgent')} htmlFor="f-agent">
              <Select id="f-agent" value={filters.commissionAgentId} onChange={(e) => setFilter('commissionAgentId', e.target.value)}>
                <option value="">{t('allAgents')}</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {canShipFilter && (
            <Field label={t('filterShipping')} htmlFor="f-shipping">
              <Select id="f-shipping" value={filters.shippingStatus} onChange={(e) => setFilter('shippingStatus', e.target.value)}>
                <option value="">{t('allShipping')}</option>
                {SHIPPING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`ship_${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading || !biz.ready}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        emptyMessage={hasFilters ? t('emptyFiltered') : t('empty')}
      />

      {totals && list.data && list.data.meta.total > 0 && (
        <Card className="mt-4 grid gap-3 sm:grid-cols-3" aria-label={t('totalsLabel')}>
          <Total label={t('totalSales')} value={formatMoney(totals.finalTotal)} />
          <Total label={t('totalPaid')} value={formatMoney(totals.totalPaid)} />
          <Total label={t('totalDue')} value={formatMoney(totals.totalRemaining)} tone={Number(totals.totalRemaining) > 0 ? 'text-red-600' : undefined} />
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && actions.remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
        busy={actions.remove.isPending}
        title={t('deleteTitle')}
        body={t('deleteBody', { no: deleting?.invoiceNo ?? `#${deleting?.id ?? ''}` })}
      />
      {paying && <PaymentDialog saleId={paying.id} advanceBalance={null} onClose={() => setPaying(null)} />}
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
