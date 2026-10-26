'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import { useMethodLabel } from '../../_lib/payment-dialog';
import type { SaleDetail } from '../../_lib/sale-types';
import { useBusiness, useDateFormat, usePosSettings } from '../../_lib/use-business';
import { InvoiceLayout } from './invoice-layout';
import { isPrintable, type PrintData, type PrintFormat } from './print-types';
import { ReceiptLayout } from './receipt-layout';

/**
 * Only the element with id `sale-print-area` is printed. The app shell (sidebar, top bar, tab bar) is hidden with
 * `display: none` (so it cannot add blank pages) and everything else with `visibility`. `@page` sets the paper:
 * a roll 80 mm wide for the receipt, A4 for the invoice.
 */
function printCss(format: PrintFormat): string {
  const page = format === 'receipt' ? '@page { size: 80mm auto; margin: 0; }' : '@page { size: A4; margin: 8mm; }';
  return `
${page}
@media print {
  html, body { background: #fff !important; }
  aside, header, nav { display: none !important; }
  main { padding: 0 !important; }
  body * { visibility: hidden; }
  #sale-print-area, #sale-print-area * { visibility: visible; }
  #sale-print-area { position: absolute; inset-inline-start: 0; top: 0; margin: 0 !important; box-shadow: none !important; ${format === 'receipt' ? 'width: 80mm;' : 'width: 100%; max-width: none; padding: 0 !important;'} }
}`;
}

interface PrintInfo {
  location: {
    name: string;
    landmark: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    zipCode: string | null;
    mobile: string | null;
    alternateNumber: string | null;
    email: string | null;
    website: string | null;
  };
  business: { name: string; taxLabel1: string | null; taxNumber1: string | null; taxLabel2: string | null; taxNumber2: string | null };
  layout: { headerText: string | null; footerText: string | null };
}

/** Browser-print view of a sale: 80 mm receipt or A4 invoice. `?auto=1` opens the print dialog once everything is loaded. */
export function SalePrintView({ id, format: requested, autoPrint }: { id: number; format: PrintFormat | null; autoPrint: boolean }) {
  const t = useTranslations('salePrint');
  const c = useTranslations('common');
  const biz = useBusiness();
  const fmt = useDateFormat();
  const methodLabel = useMethodLabel();
  const settings = usePosSettings();

  const sale = useQuery({ queryKey: ['sales', 'detail', id], queryFn: () => api<SaleDetail>(`/sales/${id}`), enabled: fmt.ready });

  // Address, contacts and tax numbers come from a read-only endpoint every signed-in user may call (cashiers print too).
  const locationId = sale.data?.locationId;
  const info = useQuery({
    queryKey: ['business-locations', locationId, 'print-info'],
    queryFn: () => api<PrintInfo>(`/business-locations/${locationId}/print-info`),
    enabled: !!locationId,
    retry: false,
  });

  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError;
  const ready = sale.isSuccess && fmt.ready && settled(settings) && settled(info);

  const format: PrintFormat = requested ?? (sale.data?.isDirectSale ? 'invoice' : 'receipt');

  const printed = useRef(false);
  useEffect(() => {
    if (!autoPrint || !ready || printed.current) return;
    const timer = setTimeout(() => {
      printed.current = true;
      window.print();
    }, 400);
    return () => clearTimeout(timer);
  }, [autoPrint, ready]);

  if (sale.isError) {
    const notFound = sale.error instanceof ApiError && sale.error.status === 404;
    return (
      <div className="mx-auto max-w-xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{notFound ? t('notFound') : c('loadError')}</span>
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void sale.refetch()}>
              {c('retry')}
            </Button>
          )}
        </Card>
      </div>
    );
  }
  if (!ready || !sale.data) {
    return (
      <div className="mx-auto max-w-xl" aria-busy="true">
        <Card>
          <div className="h-6 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-64 animate-pulse rounded bg-slate-100" />
        </Card>
      </div>
    );
  }

  const loc = info.data?.location;
  const taxSettings = info.data?.business;
  const data: PrintData = {
    sale: sale.data,
    businessName: biz.name,
    logoUrl: isPrintable(biz.logo),
    locationName: sale.data.location?.name ?? loc?.name ?? '',
    address: loc ? [loc.landmark, loc.city, loc.state, [loc.country, loc.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '',
    phones: loc ? [loc.mobile, loc.alternateNumber].filter((v): v is string => !!v) : [],
    email: loc?.email ?? null,
    website: loc?.website ?? null,
    taxNumbers: taxSettings
      ? [
          { label: taxSettings.taxLabel1 ?? '', value: taxSettings.taxNumber1 ?? '' },
          { label: taxSettings.taxLabel2 ?? '', value: taxSettings.taxNumber2 ?? '' },
        ]
          .filter((n) => n.value)
          .map((n) => ({ label: n.label || t('taxNo'), value: n.value }))
      : [],
    dateTime: fmt.dateTime,
    date: fmt.date,
    methodLabel,
  };

  const switchClass = (active: boolean) =>
    cn('inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium', active ? 'bg-primary text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50');

  return (
    <div>
      <style>{printCss(format)}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/m/sell/sales/${id}`} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t('backToSale')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/m/sell/sales/${id}/print?format=receipt`} replace className={switchClass(format === 'receipt')} aria-current={format === 'receipt' ? 'true' : undefined}>
            {t('formatReceipt')}
          </Link>
          <Link href={`/m/sell/sales/${id}/print?format=invoice`} replace className={switchClass(format === 'invoice')} aria-current={format === 'invoice' ? 'true' : undefined}>
            {t('formatInvoice')}
          </Link>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t('print')}
          </Button>
        </div>
      </div>
      {format === 'receipt' ? <ReceiptLayout data={data} /> : <InvoiceLayout data={data} />}
    </div>
  );
}
