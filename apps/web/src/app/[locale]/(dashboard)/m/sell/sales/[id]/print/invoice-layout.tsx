import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/utils';
import { formatPercent, formatQuantity } from '../../_lib/format';
import { detailCustomerLabel } from '../../_lib/sale-types';
import { documentTitleKey, nonZero, plainMoney, splitPayments, type PrintData } from './print-types';

const TH = 'border-b border-black px-2 py-1.5 text-start text-[11px] font-semibold uppercase';
const TD = 'border-b border-slate-300 px-2 py-1.5 align-top';

/** A4 invoice / quotation (Laravel: sale_pos/receipts/classic.blade.php with an A4 layout). */
export function InvoiceLayout({ data }: { data: PrintData }) {
  const t = useTranslations('salePrint');
  const { sale } = data;
  const totals = sale.totals;
  const { paid, change } = splitPayments(sale);
  const lines = sale.lines.filter((l) => l.parentSellLineId === null);
  const isFinal = sale.status === 'final';
  const customer = sale.customer;
  const statusKey = sale.paymentStatus === 'paid' ? 'statusPaid' : sale.paymentStatus === 'partial' ? 'statusPartial' : 'statusDue';

  return (
    <div id="sale-print-area" data-format="invoice" className="mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-[13px] leading-snug text-black shadow-card">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {data.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="mb-2 max-h-20 max-w-[60mm] object-contain" />
          )}
          <p className="text-xl font-bold">{data.businessName}</p>
          {data.locationName && <p className="font-semibold">{data.locationName}</p>}
          {data.address && <p>{data.address}</p>}
          {data.phones.length > 0 && (
            <p>
              {t('phone')}: {data.phones.join(' / ')}
            </p>
          )}
          {data.email && (
            <p>
              {t('email')}: {data.email}
            </p>
          )}
          {data.website && <p>{data.website}</p>}
          {data.taxNumbers.map((n) => (
            <p key={n.label}>
              {n.label}: {n.value}
            </p>
          ))}
        </div>
        <div className="shrink-0 text-end">
          <p className="text-2xl font-bold uppercase tracking-wide">{t(documentTitleKey(sale))}</p>
          <p className="mt-1 text-base font-semibold">{sale.invoiceNo ?? `#${sale.id}`}</p>
          <p>
            <span className="text-slate-600">{t('date')}: </span>
            {data.dateTime(sale.transactionDate)}
          </p>
          {isFinal && (
            <p className="mt-1 inline-block rounded border border-black px-2 py-0.5 text-[11px] font-semibold uppercase">{t(statusKey)}</p>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-6 border-y border-slate-300 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase text-slate-600">{t('billTo')}</p>
          <p className="font-semibold">{detailCustomerLabel(customer) || t('walkIn')}</p>
          {customer && !customer.isDefault && (
            <>
              {customer.addressLine1 && <p>{[customer.addressLine1, customer.city].filter(Boolean).join(', ')}</p>}
              {customer.mobile && (
                <p>
                  {t('mobile')}: {customer.mobile}
                </p>
              )}
              {customer.email && <p>{customer.email}</p>}
            </>
          )}
        </div>
        <div>
          {sale.shipping.address || sale.shipping.details ? (
            <>
              <p className="text-[11px] font-semibold uppercase text-slate-600">{t('shipTo')}</p>
              {sale.shipping.address && <p className="whitespace-pre-wrap">{sale.shipping.address}</p>}
              {sale.shipping.details && <p className="whitespace-pre-wrap">{sale.shipping.details}</p>}
            </>
          ) : (
            sale.addedBy && (
              <>
                <p className="text-[11px] font-semibold uppercase text-slate-600">{t('servedBy')}</p>
                <p>{sale.addedBy}</p>
              </>
            )
          )}
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-start">
        <thead>
          <tr>
            <th scope="col" className={TH}>
              #
            </th>
            <th scope="col" className={TH}>
              {t('item')}
            </th>
            <th scope="col" className={`${TH} text-end`}>
              {t('qty')}
            </th>
            <th scope="col" className={`${TH} text-end`}>
              {t('unitPrice')}
            </th>
            <th scope="col" className={`${TH} text-end`}>
              {t('discount')}
            </th>
            <th scope="col" className={`${TH} text-end`}>
              {t('tax')}
            </th>
            <th scope="col" className={`${TH} text-end`}>
              {t('amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const unit = l.subUnitName ?? l.unit?.shortName ?? '';
            return (
              <tr key={l.id} className="break-inside-avoid">
                <td className={`${TD} text-slate-600`}>{i + 1}</td>
                <td className={TD}>
                  <span className="font-medium">
                    {l.productName}
                    {l.variationName ? ` - ${l.variationName}` : ''}
                  </span>
                  {l.sku && <div className="text-[11px] text-slate-600">{l.sku}</div>}
                  {l.sellLineNote && <div className="text-[11px] italic">{l.sellLineNote}</div>}
                </td>
                <td className={`${TD} whitespace-nowrap text-end`}>
                  {formatQuantity(l.quantity)} {unit}
                </td>
                <td className={`${TD} whitespace-nowrap text-end`}>{plainMoney(l.unitPriceBeforeDiscount)}</td>
                <td className={`${TD} whitespace-nowrap text-end`}>
                  {nonZero(l.lineDiscountAmount) ? (l.lineDiscountType === 'percentage' ? `${formatPercent(l.lineDiscountAmount)}%` : plainMoney(l.lineDiscountAmount)) : '-'}
                </td>
                <td className={`${TD} whitespace-nowrap text-end`}>{nonZero(l.itemTax) ? plainMoney(l.itemTax) : '-'}</td>
                <td className={`${TD} whitespace-nowrap text-end font-medium`}>{plainMoney(l.lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 flex items-start justify-between gap-8">
        <div className="min-w-0 flex-1 space-y-3">
          {sale.saleNote && (
            <div>
              <p className="text-[11px] font-semibold uppercase text-slate-600">{t('notes')}</p>
              <p className="whitespace-pre-wrap">{sale.saleNote}</p>
            </div>
          )}
          {isFinal && paid.length > 0 && (
            <div className="break-inside-avoid">
              <p className="text-[11px] font-semibold uppercase text-slate-600">{t('payments')}</p>
              <table className="mt-1 w-full border-collapse text-[12px]">
                <tbody>
                  {paid.map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-slate-300 py-1 pe-2">{data.date(p.paidOn)}</td>
                      <td className="border-b border-slate-300 py-1 pe-2">{data.methodLabel(p.method)}</td>
                      <td className="whitespace-nowrap border-b border-slate-300 py-1 text-end">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                  {change.map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-slate-300 py-1 pe-2">{data.date(p.paidOn)}</td>
                      <td className="border-b border-slate-300 py-1 pe-2">{t('change')}</td>
                      <td className="whitespace-nowrap border-b border-slate-300 py-1 text-end">-{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <dl className="w-[72mm] shrink-0 space-y-1 break-inside-avoid">
          <Pair label={t('subtotal')} value={formatMoney(totals.totalBeforeTax)} />
          {nonZero(totals.discountValue) && <Pair label={`${t('discount')}${totals.discountType === 'percentage' ? ` (${formatPercent(totals.discountAmount)}%)` : ''}`} value={`-${formatMoney(totals.discountValue)}`} />}
          {nonZero(totals.rpRedeemedAmount) && <Pair label={t('rewardPoints')} value={`-${formatMoney(totals.rpRedeemedAmount)}`} />}
          {nonZero(totals.taxAmount) && <Pair label={`${totals.orderTaxName ?? t('tax')}${nonZero(totals.orderTaxRate) ? ` (${formatPercent(totals.orderTaxRate)}%)` : ''}`} value={formatMoney(totals.taxAmount)} />}
          {nonZero(totals.shippingCharges) && <Pair label={t('shipping')} value={formatMoney(totals.shippingCharges)} />}
          {nonZero(totals.packingCharge) && <Pair label={t('packing')} value={formatMoney(totals.packingCharge)} />}
          {totals.additionalExpenses
            .filter((e) => nonZero(e.value))
            .map((e, i) => (
              <Pair key={`${e.key}-${i}`} label={e.key || t('additional')} value={formatMoney(e.value)} />
            ))}
          {nonZero(totals.roundOffAmount) && <Pair label={t('roundOff')} value={formatMoney(totals.roundOffAmount)} />}
          <div className="flex justify-between gap-3 border-y-2 border-black py-1.5 text-base font-bold">
            <dt>{t('total')}</dt>
            <dd className="whitespace-nowrap">{formatMoney(totals.finalTotal)}</dd>
          </div>
          {isFinal && (
            <>
              <Pair label={t('totalPaid')} value={formatMoney(totals.totalPaid)} />
              <Pair label={t('balanceDue')} value={formatMoney(totals.totalDue)} bold />
            </>
          )}
        </dl>
      </div>

      <p className="mt-10 border-t border-slate-300 pt-3 text-center text-[12px] text-slate-700">{t('thankYou')}</p>
    </div>
  );
}

function Pair({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-bold' : ''}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap text-end">{value}</dd>
    </div>
  );
}
