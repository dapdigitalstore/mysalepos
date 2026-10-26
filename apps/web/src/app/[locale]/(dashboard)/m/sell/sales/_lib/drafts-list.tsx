'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye, FilePlus2, FileText, Pencil, Printer, Receipt, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { ActionMenu, type MenuItem } from './action-menu';
import { KindBadge } from './badges';
import { DateRangeFilter, NO_RANGE, type RangeValue } from './date-range-filter';
import { customerLabel, type DraftList, type SaleRow } from './sale-types';
import { useBusiness, useDateFormat, useLocationOptions, useUserOptions } from './use-business';
import { useSaleActions } from './use-sale-actions';

type Mode = 'drafts' | 'quotations';

/** Laravel: sell/drafts + sell/quotations (SellController@getDrafts / getQuotations). One list for both. */
export function DraftsList({ mode }: { mode: Mode }) {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const can = useCan();
  const biz = useBusiness();
  const fmt = useDateFormat();
  const isQuotations = mode === 'quotations';

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [range, setRange] = useState<RangeValue>(NO_RANGE);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'transaction_date', sortDir: 'desc' });
  const [deleting, setDeleting] = useState<SaleRow | null>(null);
  const [converting, setConverting] = useState<SaleRow | null>(null);
  const debounced = useDebounced(search);

  useEffect(() => setPage(1), [debounced, locationId, createdBy, range.startDate, range.endDate]);

  const query = { page, search: debounced, locationId, createdBy, startDate: range.startDate, endDate: range.endDate, ...sort };
  const list = useQuery({
    queryKey: ['sales', mode, query],
    queryFn: () => api<DraftList>(`/sales/${mode}`, { query }),
    placeholderData: (prev) => prev,
    enabled: biz.ready,
  });
  const locations = useLocationOptions();
  const users = useUserOptions();
  const actions = useSaleActions({ canListDrafts: true });

  const hasFilters = !!(search || locationId || createdBy || range.startDate || range.endDate);
  const clear = () => {
    setSearch('');
    setLocationId('');
    setCreatedBy('');
    setRange(NO_RANGE);
  };

  const printHref = (r: SaleRow) => `/m/sell/sales/${r.id}/print?format=invoice&auto=1`;
  const canConvert = can('sell.create', 'direct_sell.access');

  const menuFor = (r: SaleRow): MenuItem[] => [
    { key: 'view', label: t('actView'), icon: <Eye className="h-4 w-4" />, href: `/m/sell/sales/${r.id}` },
    { key: 'edit', label: t('actEdit'), icon: <Pencil className="h-4 w-4" />, href: `/m/sell/sales/${r.id}/edit`, show: can('sell.update', 'direct_sell.access') },
    { key: 'convert', label: t('actConvertInvoice'), icon: <Receipt className="h-4 w-4" />, onSelect: () => setConverting(r), show: canConvert },
    { key: 'proforma', label: t('actConvertProforma'), icon: <FilePlus2 className="h-4 w-4" />, onSelect: () => actions.convertToProforma.mutate(r.id), show: canConvert && r.subStatus === 'quotation' },
    { key: 'print', label: t('actPrintInvoice'), icon: <Printer className="h-4 w-4" />, href: printHref(r), newTab: true, show: can('print_invoice') },
    { key: 'delete', label: t('actDelete'), icon: <Trash2 className="h-4 w-4" />, onSelect: () => setDeleting(r), danger: true, show: can('sell.delete', 'direct_sell.delete') },
  ];

  const columns: Column<SaleRow>[] = [
    { key: 'transaction_date', header: t('colDate'), sortBy: 'transaction_date', cell: (r) => fmt.dateTime(r.transactionDate), className: 'whitespace-nowrap' },
    {
      key: 'invoice_no',
      header: t('colReference'),
      sortBy: 'invoice_no',
      cell: (r) => <ReferenceLink row={r} />,
      className: 'whitespace-nowrap',
    },
    ...(!isQuotations ? [{ key: 'kind', header: t('colType'), cell: (r: SaleRow) => <KindBadge status={r.status} subStatus={r.subStatus} isSuspend={false} /> }] : []),
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
    { key: 'total_items', header: t('colItems'), cell: (r) => Number(r.totalItems).toString(), className: 'text-end' },
    { key: 'final_total', header: t('colTotal'), sortBy: 'final_total', cell: (r) => formatMoney(r.finalTotal), className: 'whitespace-nowrap text-end' },
    { key: 'added_by', header: t('colAddedBy'), sortBy: 'added_by', cell: (r) => r.addedBy ?? '-', className: 'whitespace-nowrap' },
    { key: 'actions', header: c('actions'), className: 'w-16 text-end', cell: (r) => <ActionMenu label={r.invoiceNo ?? `#${r.id}`} items={menuFor(r)} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={isQuotations ? t('quotationsTitle') : t('draftsTitle')} description={isQuotations ? t('quotationsSubtitle') : t('draftsSubtitle')} />

      <Card className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('draftSearchPlaceholder')} className="ps-9" aria-label={c('search')} />
          </div>
          <Button variant="outline" className="md:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="drafts-filters">
            <SlidersHorizontal className="h-4 w-4" />
            {t('filters')}
          </Button>
          {hasFilters && (
            <Button variant="ghost" onClick={clear}>
              {t('clearFilters')}
            </Button>
          )}
        </div>
        <div id="drafts-filters" className={cn('grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4', showFilters ? 'grid' : 'hidden md:grid')}>
          <Field label={t('filterLocation')} htmlFor="d-location">
            <Select id="d-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('allLocations')}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filterCreatedBy')} htmlFor="d-created">
            <Select id="d-created" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)}>
              <option value="">{t('allUsers')}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <DateRangeFilter value={range} timeZone={biz.timeZone} onChange={setRange} idPrefix="d-date" />
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
        emptyMessage={hasFilters ? t('emptyFiltered') : isQuotations ? t('emptyQuotations') : t('emptyDrafts')}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && actions.remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
        busy={actions.remove.isPending}
        title={isQuotations ? t('deleteQuotationTitle') : t('deleteDraftTitle')}
        body={t('deleteDraftBody', { no: deleting?.invoiceNo ?? `#${deleting?.id ?? ''}` })}
      />
      <Dialog open={converting !== null} onClose={() => setConverting(null)} title={t('convertTitle')} className="max-w-sm">
        <p className="text-sm text-slate-600">{t('convertBody', { no: converting?.invoiceNo ?? `#${converting?.id ?? ''}` })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConverting(null)} disabled={actions.convertToInvoice.isPending}>
            {c('cancel')}
          </Button>
          <Button
            onClick={() => converting && actions.convertToInvoice.mutate(converting.id, { onSettled: () => setConverting(null) })}
            disabled={actions.convertToInvoice.isPending}
          >
            {t('actConvertInvoice')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ReferenceLink({ row }: { row: SaleRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <Link href={`/m/sell/sales/${row.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
        {row.invoiceNo ?? `#${row.id}`}
      </Link>
    </span>
  );
}
