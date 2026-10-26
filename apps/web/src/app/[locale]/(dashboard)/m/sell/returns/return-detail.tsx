'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { PaymentDialog } from './payment-dialog';
import { customerLabel, formatDate, formatDateTime, type ReturnDetail } from './return-types';
import { StatusBadge } from './status-badge';

/** Only the element with this id is printed: the app shell (sidebar, header) is hidden. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #return-print-area, #return-print-area * { visibility: visible; }
  #return-print-area { position: absolute; inset-inline: 0; top: 0; width: 100%; box-shadow: none; }
}`;

export function ReturnDetailView({ id, autoPrint }: { id: number; autoPrint: boolean }) {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const locale = useLocale();
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [deleting, setDeleting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState<number | null>(null);

  const q = useQuery({ queryKey: ['sell-returns', id], queryFn: () => api<ReturnDetail>(`/sell-returns/${id}`) });

  const printed = useRef(false);
  useEffect(() => {
    if (autoPrint && q.data && !printed.current) {
      printed.current = true;
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, q.data]);

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));

  const remove = useMutation({
    mutationFn: () => api(`/sell-returns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('deleted'));
      void qc.invalidateQueries({ queryKey: ['sell-returns'] });
      router.push('/m/sell/returns');
    },
    onError: (e) => {
      fail(e);
      setDeleting(false);
    },
  });

  const removePayment = useMutation({
    mutationFn: (paymentId: number) => api(`/sell-returns/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('payDeleted'));
      setDeletingPayment(null);
      void qc.invalidateQueries({ queryKey: ['sell-returns'] });
    },
    onError: (e) => {
      fail(e);
      setDeletingPayment(null);
    },
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-4xl" aria-busy="true">
        <Card>
          <div className="h-6 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-40 animate-pulse rounded bg-slate-100" />
        </Card>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto max-w-4xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{notFound ? t('notFound') : c('loadError')}</span>
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              {c('retry')}
            </Button>
          )}
        </Card>
        <p className="mt-4">
          <Link href="/m/sell/returns" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
            {t('backToList')}
          </Link>
        </p>
      </div>
    );
  }

  const r = q.data;
  const money = (v: string) => formatMoney(v);
  const due = Number(r.paymentDue);
  const methodLabel = (m: string | null) => {
    if (!m) return '-';
    return ['cash', 'card', 'cheque', 'bank_transfer', 'other', 'advance'].includes(m) ? t(`method_${m}` as 'method_cash') : m;
  };

  return (
    <div className="mx-auto max-w-4xl">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={`${t('detailTitle')} ${r.invoiceNo ?? ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              {t('print')}
            </Button>
            {r.sale && (
              <Link href={`/m/sell/returns/new?saleId=${r.sale.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Pencil className="h-4 w-4" />
                {t('edit')}
              </Link>
            )}
            <Button variant="outline" onClick={() => setDeleting(true)} className="text-red-600">
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </Button>
          </>
        }
      />

      <Card id="return-print-area" className="mb-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">{r.business.name}</p>
            {r.location && (
              <p className="text-sm text-slate-600">
                {r.location.name}
                {r.location.address && <span> - {r.location.address}</span>}
                {r.location.mobile && <span> - {r.location.mobile}</span>}
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t('detailTitle')}</p>
            <p className="text-lg font-semibold text-slate-900">{r.invoiceNo ?? `#${r.id}`}</p>
            <StatusBadge status={r.paymentStatus} />
          </div>
        </div>

        <div className="mb-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h2 className="mb-1 font-semibold text-slate-800">{t('returnDetails')}</h2>
            <p>
              <span className="text-slate-500">{t('returnDate')}: </span>
              {formatDateTime(r.transactionDate, r.timeZone, locale)}
            </p>
            <p>
              <span className="text-slate-500">{t('customer')}: </span>
              {r.customer ? customerLabel({ customerName: r.customer.name, supplierBusinessName: r.customer.supplierBusinessName }) || t('walkIn') : t('walkIn')}
            </p>
            {r.customer?.mobile && (
              <p>
                <span className="text-slate-500">#: </span>
                {r.customer.mobile}
              </p>
            )}
          </div>
          {r.sale && (
            <div>
              <h2 className="mb-1 font-semibold text-slate-800">{t('saleDetails')}</h2>
              <p>
                <span className="text-slate-500">{t('saleInvoice')}: </span>
                {r.sale.invoiceNo}
              </p>
              <p>
                <span className="text-slate-500">{t('saleDate')}: </span>
                {formatDate(r.sale.transactionDate, r.timeZone, locale)}
              </p>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold">#</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{t('product')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('unitPrice')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('colQty')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('colLineTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.lines.map((l, i) => (
                <tr key={l.sellLineId}>
                  <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{l.productName}</span>
                    {l.variationName && <span className="text-slate-600"> - {l.variationName}</span>}
                    <div className="text-xs text-slate-500">{l.sku}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-end">{money(l.unitPriceIncTax)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-end">
                    {l.quantityReturned} {l.unitName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-end">{money(l.lineTotal)}</td>
                </tr>
              ))}
              {r.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    {t('noLines')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <dl className="ms-auto mt-4 max-w-xs space-y-1.5 text-sm">
          <Line label={t('netTotal')} value={money(r.totalBeforeTax)} />
          <Line label={`${t('totalDiscount')}${r.discountType === 'percentage' ? ` (${r.discountAmount}%)` : ''}`} value={`(-) ${money(r.discount)}`} />
          {r.taxBreakdown.length > 0 ? (
            r.taxBreakdown.map((tx) => <Line key={tx.id} label={`${t('totalTax')} - ${tx.name}`} value={`(+) ${money(tx.amount)}`} />)
          ) : (
            <Line label={t('totalTax')} value={`(+) ${money(r.taxAmount)}`} />
          )}
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>{t('returnTotal')}</dt>
            <dd>{money(r.finalTotal)}</dd>
          </div>
          <Line label={t('colPaid')} value={money(r.amountPaid)} />
          <Line label={t('colDue')} value={money(r.paymentDue)} tone={due > 0 ? 'text-red-600' : undefined} />
        </dl>
        <p className="mt-6 hidden text-center text-sm text-slate-500 print:block">{t('thankYou')}</p>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">{t('paymentsTitle')}</h2>
          {can('sell.payments') && r.paymentStatus !== 'paid' && (
            <Button size="sm" onClick={() => setPaying(true)}>
              <Plus className="h-4 w-4" />
              {t('addPayment')}
            </Button>
          )}
        </div>
        {r.payments.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('noPayments')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-start text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t('payRefNo')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t('payDate')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t('payMethod')}</th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">{t('payAmount')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">{t('payNote')}</th>
                  <th scope="col" className="w-16 px-3 py-2"><span className="sr-only">{c('actions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-3 py-2">{p.paymentRefNo ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(p.paidOn, r.timeZone, locale)}</td>
                    <td className="px-3 py-2">{methodLabel(p.method)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">{money(p.amount)}</td>
                    <td className="px-3 py-2 text-slate-600">{p.note}</td>
                    <td className="px-3 py-2 text-end">
                      {can('delete_sell_payment') && (
                        <Button variant="ghost" size="sm" onClick={() => setDeletingPayment(p.id)} aria-label={`${t('delete')} ${p.paymentRefNo ?? p.id}`}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4">
        <Link href="/m/sell/returns" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
          {t('backToList')}
        </Link>
      </p>

      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} busy={remove.isPending} title={t('deleteTitle')} body={t('deleteBody')} />
      <ConfirmDialog
        open={deletingPayment !== null}
        onClose={() => setDeletingPayment(null)}
        onConfirm={() => deletingPayment !== null && removePayment.mutate(deletingPayment)}
        busy={removePayment.isPending}
        title={t('payDeleteTitle')}
        body={t('payDeleteBody')}
      />
      {paying && <PaymentDialog returnId={id} due={r.paymentDue} onClose={() => setPaying(false)} />}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-slate-700">
      <dt>{label}</dt>
      <dd className={cn('whitespace-nowrap', tone)}>{value}</dd>
    </div>
  );
}
