'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, Pencil, Plus, Printer, Receipt, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { KindBadge, PaymentBadge, ShippingBadge } from '../_lib/badges';
import { formatPercent, formatQuantity } from '../_lib/format';
import { PaymentDialog, useMethodLabel } from '../_lib/payment-dialog';
import { detailCustomerLabel, type SaleDetail, type SaleLine, type SalePayment } from '../_lib/sale-types';
import { useDateFormat } from '../_lib/use-business';
import { useSaleActions } from '../_lib/use-sale-actions';

const LINK_BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
const TH = 'px-3 py-2 text-start font-semibold';

const nonZero = (v: string | number | null | undefined) => v !== null && v !== undefined && Number(v) !== 0;

/** Laravel: sell/show.blade.php (view sale modal) as a full page. */
export function SaleDetailView({ id }: { id: number }) {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useDateFormat();
  const methodLabel = useMethodLabel();

  const [deleting, setDeleting] = useState(false);
  const [paying, setPaying] = useState<SalePayment | 'new' | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<SalePayment | null>(null);

  const q = useQuery({ queryKey: ['sales', 'detail', id], queryFn: () => api<SaleDetail>(`/sales/${id}`), enabled: fmt.ready });
  const actions = useSaleActions({ afterDelete: () => router.push('/m/sell/sales') });

  const removePayment = useMutation({
    mutationFn: (paymentId: number) => api(`/sale-payments/${paymentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('payDeleted'));
      setDeletingPayment(null);
      void qc.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeletingPayment(null);
    },
  });

  if (q.isLoading || !fmt.ready) {
    return (
      <div className="mx-auto max-w-5xl" aria-busy="true">
        <Card>
          <div className="h-6 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-48 animate-pulse rounded bg-slate-100" />
        </Card>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto max-w-5xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{notFound ? t('notFound') : c('loadError')}</span>
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              {c('retry')}
            </Button>
          )}
        </Card>
        <p className="mt-4">
          <Link href="/m/sell/sales" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
            {t('backToList')}
          </Link>
        </p>
      </div>
    );
  }

  const s = q.data;
  const no = s.invoiceNo ?? `#${s.id}`;
  const isFinal = s.status === 'final';
  const isDraftLike = s.status === 'draft';
  const totals = s.totals;
  const hasReturn = s.returns.length > 0;
  const due = Number(totals.totalDue);
  const customer = s.customer;
  const title = isDraftLike ? (s.subStatus === 'quotation' ? t('titleQuotation') : s.subStatus === 'proforma' ? t('titleProforma') : t('titleDraft')) : t('titleSale');
  const canPay = can('sell.payments') && isFinal && !s.isSuspend && due > 0;
  const canPrint = can('print_invoice');
  const printHref = (format: 'receipt' | 'invoice') => `/m/sell/sales/${s.id}/print?format=${format}&auto=1`;
  const hasShipping = !!(s.shipping.status || s.shipping.details || s.shipping.address || s.shipping.deliveredTo || nonZero(totals.shippingCharges));
  const advanceBalance = customer && !customer.isDefault ? customer.balance : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${title} ${no}`}
        actions={
          <>
            <Link href={isDraftLike ? (s.subStatus === 'quotation' ? '/m/sell/quotations' : '/m/sell/drafts') : '/m/sell/sales'} className={LINK_BUTTON}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {t('back')}
            </Link>
            {canPrint && (
              <>
                <Link href={printHref('receipt')} target="_blank" rel="noopener" className={LINK_BUTTON}>
                  <Receipt className="h-4 w-4" />
                  {t('actPrintReceipt')}
                </Link>
                <Link href={printHref('invoice')} target="_blank" rel="noopener" className={LINK_BUTTON}>
                  <Printer className="h-4 w-4" />
                  {t('actPrintInvoice')}
                </Link>
              </>
            )}
            {can('sell.update', 'direct_sell.access') && !hasReturn && (
              <Link href={`/m/sell/sales/${s.id}/edit`} className={LINK_BUTTON}>
                <Pencil className="h-4 w-4" />
                {t('actEdit')}
              </Link>
            )}
            {isDraftLike && can('sell.create', 'direct_sell.access') && (
              <Button onClick={() => actions.convertToInvoice.mutate(s.id)} disabled={actions.convertToInvoice.isPending}>
                {t('actConvertInvoice')}
              </Button>
            )}
            {canPay && (
              <Button onClick={() => setPaying('new')}>
                <CreditCard className="h-4 w-4" />
                {t('actAddPayment')}
              </Button>
            )}
            {isFinal && !s.isSuspend && can('access_sell_return', 'access_own_sell_return') && (
              <Link href={`/m/sell/returns/new?saleId=${s.id}`} className={LINK_BUTTON}>
                <RotateCcw className="h-4 w-4" />
                {t('actReturn')}
              </Link>
            )}
            {can('sell.delete', 'direct_sell.delete') && (
              <Button variant="outline" className="text-red-600" onClick={() => setDeleting(true)}>
                <Trash2 className="h-4 w-4" />
                {t('actDelete')}
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <div className="grid gap-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <h2 className="font-semibold text-slate-800">{t('secSale')}</h2>
            <Info label={t('lblInvoiceNo')} value={no} />
            <Info label={t('lblDate')} value={fmt.dateTime(s.transactionDate)} />
            <Info label={t('lblLocation')} value={s.location?.name ?? '-'} />
            <Info label={t('lblAddedBy')} value={s.addedBy ?? '-'} />
            {s.payTermNumber ? <Info label={t('lblPayTerm')} value={`${s.payTermNumber} ${s.payTermType === 'months' ? t('months') : t('days')}`} /> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <KindBadge status={s.status} subStatus={s.subStatus} isSuspend={s.isSuspend} />
              {isFinal && <PaymentBadge status={s.displayPaymentStatus ?? s.paymentStatus} />}
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-semibold text-slate-800">{t('secCustomer')}</h2>
            <p className="text-slate-900">{customer ? detailCustomerLabel(customer) || t('walkIn') : t('walkIn')}</p>
            {customer?.contactCode && <Info label={t('lblContactId')} value={customer.contactCode} />}
            {customer?.mobile && <Info label={t('lblMobile')} value={customer.mobile} />}
            {customer?.email && <Info label={t('lblEmail')} value={customer.email} />}
            {(customer?.addressLine1 || customer?.city) && <Info label={t('lblAddress')} value={[customer.addressLine1, customer.city].filter(Boolean).join(', ')} />}
          </div>

          {hasShipping && (
            <div className="space-y-1.5">
              <h2 className="font-semibold text-slate-800">{t('secShipping')}</h2>
              {s.shipping.status && (
                <p>
                  <ShippingBadge status={s.shipping.status} />
                </p>
              )}
              {s.shipping.address && <Info label={t('lblShippingAddress')} value={s.shipping.address} />}
              {s.shipping.details && <Info label={t('lblShippingDetails')} value={s.shipping.details} />}
              {s.shipping.deliveredTo && <Info label={t('lblDeliveredTo')} value={s.shipping.deliveredTo} />}
              {s.shipping.deliveryPerson ? <Info label={t('lblDeliveryPerson')} value={String(s.shipping.deliveryPerson)} /> : null}
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-6 p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-start text-sm">
            <caption className="sr-only">{t('secLines')}</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className={TH}>
                  #
                </th>
                <th scope="col" className={TH}>
                  {t('colProduct')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colQty')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colUnitPrice')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colDiscount')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colTax')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colPriceIncTax')}
                </th>
                <th scope="col" className={cn(TH, 'text-end')}>
                  {t('colSubtotal')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.lines.map((l, i) => (
                <LineRow key={l.id} line={l} index={i + 1} />
              ))}
              {s.lines.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    {t('noLines')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 text-sm">
          <h2 className="font-semibold text-slate-800">{t('secNotes')}</h2>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('lblSaleNote')}</p>
            <p className="whitespace-pre-wrap text-slate-700">{s.saleNote || '-'}</p>
          </div>
          {s.staffNote && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('lblStaffNote')}</p>
              <p className="whitespace-pre-wrap text-slate-700">{s.staffNote}</p>
            </div>
          )}
        </Card>

        <Card>
          <dl className="ms-auto max-w-sm space-y-1.5 text-sm">
            <Row label={t('totSubtotal')} value={formatMoney(totals.totalBeforeTax)} />
            {nonZero(totals.discountValue) && (
              <Row label={`${t('totDiscount')}${totals.discountType === 'percentage' ? ` (${formatPercent(totals.discountAmount)}%)` : ''}`} value={`(-) ${formatMoney(totals.discountValue)}`} />
            )}
            {nonZero(totals.rpRedeemedAmount) && <Row label={t('totRewardPoints')} value={`(-) ${formatMoney(totals.rpRedeemedAmount)}`} />}
            {(nonZero(totals.taxAmount) || totals.orderTaxName) && (
              <Row label={`${t('totOrderTax')}${totals.orderTaxName ? ` (${totals.orderTaxName} ${formatPercent(totals.orderTaxRate)}%)` : ''}`} value={`(+) ${formatMoney(totals.taxAmount)}`} />
            )}
            {nonZero(totals.shippingCharges) && <Row label={t('totShipping')} value={`(+) ${formatMoney(totals.shippingCharges)}`} />}
            {nonZero(totals.packingCharge) && <Row label={t('totPacking')} value={`(+) ${formatMoney(totals.packingCharge)}`} />}
            {totals.additionalExpenses
              .filter((e) => nonZero(e.value))
              .map((e, i) => (
                <Row key={`${e.key}-${i}`} label={e.key || t('totAdditional')} value={`(+) ${formatMoney(e.value)}`} />
              ))}
            {nonZero(totals.roundOffAmount) && <Row label={t('totRoundOff')} value={formatMoney(totals.roundOffAmount)} />}
            <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
              <dt>{t('totTotal')}</dt>
              <dd>{formatMoney(totals.finalTotal)}</dd>
            </div>
            {isFinal && (
              <>
                <Row label={t('totPaid')} value={formatMoney(totals.totalPaid)} />
                <Row label={t('totDue')} value={formatMoney(totals.totalDue)} tone={due > 0 ? 'text-red-600 font-medium' : undefined} />
              </>
            )}
          </dl>
        </Card>
      </div>

      {isFinal && (
        <Card id="payments" className="mb-6 scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">{t('secPayments')}</h2>
            {canPay && (
              <Button size="sm" onClick={() => setPaying('new')}>
                <Plus className="h-4 w-4" />
                {t('actAddPayment')}
              </Button>
            )}
          </div>
          {s.payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">{t('noPayments')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-start text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className={TH}>
                      {t('payRefNo')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('payDate')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('payMethod')}
                    </th>
                    <th scope="col" className={cn(TH, 'text-end')}>
                      {t('payAmount')}
                    </th>
                    <th scope="col" className={TH}>
                      {t('payNote')}
                    </th>
                    <th scope="col" className="w-24 px-3 py-2">
                      <span className="sr-only">{c('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {s.payments.map((p) => {
                    const editable = can('edit_sell_payment') && p.method !== 'advance' && !p.isReturn;
                    const details = [p.chequeNumber, p.bankAccountNumber, p.transactionNo, p.cardTransactionNumber].filter(Boolean).join(' / ');
                    return (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap px-3 py-2">{p.paymentRefNo ?? '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{fmt.dateTime(p.paidOn)}</td>
                        <td className="px-3 py-2">
                          {p.isReturn ? t('payChange') : methodLabel(p.method)}
                          {details && <div className="text-xs text-slate-500">{details}</div>}
                        </td>
                        <td className={cn('whitespace-nowrap px-3 py-2 text-end', p.isReturn && 'text-red-600')}>
                          {p.isReturn ? '-' : ''}
                          {formatMoney(p.amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{p.note}</td>
                        <td className="px-3 py-2 text-end">
                          <div className="flex justify-end gap-1">
                            {editable && (
                              <Button variant="ghost" size="sm" onClick={() => setPaying(p)} aria-label={`${t('actEdit')} ${p.paymentRefNo ?? p.id}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {can('delete_sell_payment') && (
                              <Button variant="ghost" size="sm" onClick={() => setDeletingPayment(p)} aria-label={`${t('actDelete')} ${p.paymentRefNo ?? p.id}`}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {hasReturn && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('secReturns')}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {s.returns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/m/sell/returns/${r.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
                  {r.invoiceNo ?? `#${r.id}`}
                </Link>
                <span className="text-slate-500">{fmt.dateTime(r.transactionDate)}</span>
                <span>{formatMoney(r.finalTotal)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-4">
        <Link href="/m/sell/sales" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
          {t('backToList')}
        </Link>
      </p>

      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => actions.remove.mutate(s.id, { onSettled: () => setDeleting(false) })} busy={actions.remove.isPending} title={t('deleteTitle')} body={t('deleteBody', { no })} />
      <ConfirmDialog
        open={deletingPayment !== null}
        onClose={() => setDeletingPayment(null)}
        onConfirm={() => deletingPayment && removePayment.mutate(deletingPayment.id)}
        busy={removePayment.isPending}
        title={t('payDeleteTitle')}
        body={t('payDeleteBody')}
      />
      {paying === 'new' && <PaymentDialog saleId={s.id} advanceBalance={advanceBalance} onClose={() => setPaying(null)} />}
      {paying !== null && paying !== 'new' && <PaymentDialog saleId={s.id} payment={paying} advanceBalance={advanceBalance} onClose={() => setPaying(null)} />}
    </div>
  );
}

function LineRow({ line: l, index }: { line: SaleLine; index: number }) {
  const t = useTranslations('sales');
  const isChild = l.parentSellLineId !== null;
  const unit = l.subUnitName ?? l.unit?.shortName ?? '';
  const discount = !nonZero(l.lineDiscountAmount) ? '-' : l.lineDiscountType === 'percentage' ? `${formatPercent(l.lineDiscountAmount)}%` : formatMoney(l.lineDiscountAmount);
  return (
    <tr className={cn(isChild && 'bg-slate-50/60 text-slate-500')}>
      <td className="px-3 py-2 text-slate-500">{isChild ? '' : index}</td>
      <td className={cn('px-3 py-2', isChild && 'ps-8')}>
        <span className={cn('font-medium', isChild ? 'text-slate-600' : 'text-slate-900')}>{l.productName}</span>
        {l.variationName && <span className="text-slate-600"> - {l.variationName}</span>}
        {isChild && <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{t('comboPart')}</span>}
        <div className="text-xs text-slate-500">{l.sku}</div>
        {l.sellLineNote && <div className="text-xs italic text-slate-500">{l.sellLineNote}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end">
        {formatQuantity(l.quantity)} {unit}
        {Number(l.quantityReturned) > 0 && <div className="text-xs text-amber-700">{t('returnedQty', { qty: formatQuantity(l.quantityReturned) })}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end">{formatMoney(l.unitPriceBeforeDiscount)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-end">{discount}</td>
      <td className="whitespace-nowrap px-3 py-2 text-end">
        {nonZero(l.itemTax) ? formatMoney(l.itemTax) : '-'}
        {nonZero(l.taxRate) && <div className="text-xs text-slate-500">{formatPercent(l.taxRate)}%</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-end">{formatMoney(l.unitPriceIncTax)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-end font-medium text-slate-900">{formatMoney(l.lineTotal)}</td>
    </tr>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-slate-500">{label}: </span>
      <span className="text-slate-900">{value}</span>
    </p>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-slate-700">
      <dt>{label}</dt>
      <dd className={cn('whitespace-nowrap', tone)}>{value}</dd>
    </div>
  );
}
