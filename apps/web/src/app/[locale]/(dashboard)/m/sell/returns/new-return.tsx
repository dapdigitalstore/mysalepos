'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { Link } from '@/i18n/routing';
import { api, ApiError, type Paginated } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { ReturnForm } from './return-form';
import { customerLabel, formatDateTime, type Lookup, type Option, type SaleRow } from './return-types';
import { StatusBadge } from './status-badge';

/** Step 1: find the sale (by invoice number or from a list). Step 2: the return form. */
export function NewReturn({ saleId: initialSaleId }: { saleId: number | null }) {
  const t = useTranslations('sellReturns');
  const [saleId, setSaleId] = useState<number | null>(initialSaleId);

  useEffect(() => setSaleId(initialSaleId), [initialSaleId]);

  if (saleId !== null) {
    return <FormStep saleId={saleId} onChange={() => setSaleId(null)} changeLabel={t('changeSale')} />;
  }
  return <PickStep onPick={setSaleId} />;
}

function FormStep({ saleId, onChange, changeLabel }: { saleId: number; onChange: () => void; changeLabel: string }) {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const lookup = useQuery({
    queryKey: ['sell-returns', 'lookup', saleId],
    queryFn: () => api<Lookup>('/sell-returns/lookup', { query: { saleId } }),
    // The form owns its state; never refetch under the user's hands.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const header = (editing: boolean) => (
    <PageHeader
      title={editing ? t('editTitle') : t('newTitle')}
      actions={
        <Button variant="outline" onClick={onChange}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {changeLabel}
        </Button>
      }
    />
  );

  if (lookup.isLoading) {
    return (
      <div className="mx-auto max-w-5xl" aria-busy="true">
        {header(false)}
        <Card>
          <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-40 animate-pulse rounded bg-slate-100" />
        </Card>
      </div>
    );
  }
  if (lookup.isError || !lookup.data) {
    const msg = lookup.error instanceof ApiError && lookup.error.messages[0] ? lookup.error.messages[0] : c('loadError');
    return (
      <div className="mx-auto max-w-5xl">
        {header(false)}
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{msg}</span>
          <Button variant="outline" size="sm" onClick={() => void lookup.refetch()}>
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl">
      {header(lookup.data.existingReturn !== null)}
      <ReturnForm data={lookup.data} />
    </div>
  );
}

function PickStep({ onPick }: { onPick: (saleId: number) => void }) {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const locale = useLocale();

  const [invoiceNo, setInvoiceNo] = useState('');
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'transaction_date', sortDir: 'desc' });
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [debounced, locationId]);

  const query = { page, search: debounced, locationId, ...sort };
  const sales = useQuery({
    queryKey: ['sell-returns', 'sales', query],
    queryFn: () => api<Paginated<SaleRow>>('/sell-returns/sales', { query }),
    placeholderData: (prev) => prev,
  });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });

  const find = async () => {
    const value = invoiceNo.trim();
    if (!value) return;
    setFinding(true);
    setFindError(null);
    try {
      const r = await api<Lookup>('/sell-returns/lookup', { query: { invoiceNo: value } });
      onPick(r.sale.id);
    } catch (e) {
      setFindError(e instanceof ApiError && e.status === 404 ? t('saleNotFound') : e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
    } finally {
      setFinding(false);
    }
  };

  const columns: Column<SaleRow>[] = [
    { key: 'transaction_date', header: t('colDate'), sortBy: 'transaction_date', cell: (r) => formatDateTime(r.transactionDate, r.timeZone, locale), className: 'whitespace-nowrap' },
    { key: 'invoice_no', header: t('colSaleNo'), sortBy: 'invoice_no', cell: (r) => <span className="font-medium text-slate-900">{r.invoiceNo ?? `#${r.id}`}</span>, className: 'whitespace-nowrap' },
    { key: 'customer', header: t('colCustomer'), cell: (r) => customerLabel(r) || t('walkIn') },
    { key: 'location', header: t('colLocation'), cell: (r) => r.locationName ?? '-' },
    { key: 'final_total', header: t('colSaleTotal'), sortBy: 'final_total', cell: (r) => formatMoney(r.finalTotal), className: 'whitespace-nowrap text-end' },
    { key: 'status', header: t('colStatus'), cell: (r) => <StatusBadge status={r.paymentStatus} /> },
    {
      key: 'return',
      header: t('colReturn'),
      cell: (r) => (r.returnId ? <span className="text-xs text-amber-700">{t('alreadyReturned')}: {r.returnInvoiceNo}</span> : '-'),
    },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-40',
      cell: (r) => (
        <Button size="sm" variant={r.returnId ? 'outline' : 'primary'} onClick={() => onPick(r.id)}>
          {r.returnId ? t('editReturn') : t('startReturn')}
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('newTitle')} description={t('newSubtitle')} />

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('findByInvoice')}</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <Field label={t('invoiceNoLabel')} htmlFor="sale-invoice-no" error={findError ?? undefined} className="w-full max-w-sm">
            <Input id="sale-invoice-no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder={t('invoiceNoPlaceholder')} autoFocus autoComplete="off" />
          </Field>
          <Button type="submit" disabled={finding || invoiceNo.trim() === ''}>
            <Search className="h-4 w-4" />
            {finding ? t('finding') : t('find')}
          </Button>
        </form>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('orPick')}</h2>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('salesSearchPlaceholder')} className="ps-9" aria-label={c('search')} />
        </div>
        <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label={t('filterLocation')} className="w-auto min-w-40">
          <option value="">{t('allLocations')}</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={sales.data?.data}
        rowKey={(r) => r.id}
        loading={sales.isLoading}
        error={sales.isError ? c('loadError') : null}
        onRetry={() => void sales.refetch()}
        meta={sales.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        emptyMessage={t('noSales')}
      />
      <p className="mt-4">
        <Link href="/m/sell/returns" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
          {t('backToList')}
        </Link>
      </p>
    </div>
  );
}
