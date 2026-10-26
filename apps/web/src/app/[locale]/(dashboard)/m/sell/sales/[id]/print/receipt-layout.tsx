import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/utils';
import { formatPercent, formatQuantity, fromUnits, toUnits } from '../../_lib/format';
import { detailCustomerLabel } from '../../_lib/sale-types';
import { documentTitleKey, nonZero, plainMoney, splitPayments, type PrintData } from './print-types';

/** 80 mm thermal receipt (Laravel: sale_pos/receipts/classic.blade.php / slim). Width is 80 mm, content 72 mm. */
export function ReceiptLayout({ data }: { data: PrintData }) {
  const t = useTranslations('salePrint');
  const { sale } = data;
  const totals = sale.totals;
  const { paid, change } = splitPayments(sale);
  const changeUnits = change.reduce((sum, p) => sum + (toUnits(p.amount) ?? BigInt(0)), BigInt(0));
  const lines = sale.lines.filter((l) => l.parentSellLineId === null);
  const isFinal = sale.status === 'final';
  const customer = detailCustomerLabel(sale.customer);

  return (
    <div id="sale-print-area" data-format="receipt" className="mx-auto w-[80mm] bg-white px-[4mm] py-[4mm] text-[12px] leading-snug text-black shadow-card">
      <div className="text-center">
        {data.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logoUrl} alt="" className="mx-auto mb-1 max-h-16 max-w-[60mm] object-contain" />
        )}
        <p className="text-[15px] font-bold">{data.businessName}</p>
        {data.locationName && <p className="font-semibold">{data.locationName}</p>}
        {data.address && <p>{data.address}</p>}
        {data.phones.length > 0 && <p>{data.phones.join(' / ')}</p>}
        {data.email && <p>{data.email}</p>}
        {data.website && <p>{data.website}</p>}
        {data.taxNumbers.map((n) => (
          <p key={n.label}>
            {n.label}: {n.value}
          </p>
        ))}
        <p className="mt-1.5 text-[13px] font-bold uppercase tracking-wide">{t(documentTitleKey(sale))}</p>
      </div>

      <Rule />
      <dl className="space-y-0.5">
        <Pair label={t('invoiceNo')} value={sale.invoiceNo ?? `#${sale.id}`} />
        <Pair label={t('date')} value={data.dateTime(sale.transactionDate)} />
        {customer && <Pair label={t('customer')} value={customer} />}
        {sale.customer?.mobile && !sale.customer.isDefault && <Pair label={t('mobile')} value={sale.customer.mobile} />}
        {sale.addedBy && <Pair label={t('servedBy')} value={sale.addedBy} />}
      </dl>
      <Rule />

      <table className="w-full text-start">
        <thead>
          <tr className="text-[11px] uppercase">
            <th scope="col" className="pb-1 text-start font-semibold">
              {t('item')}
            </th>
            <th scope="col" className="pb-1 text-end font-semibold">
              {t('amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const unit = l.subUnitName ?? l.unit?.shortName ?? '';
            return (
              <tr key={l.id} className="align-top">
                <td className="pb-1 pe-2">
                  <span className="font-medium">
                    {l.productName}
                    {l.variationName ? ` - ${l.variationName}` : ''}
                  </span>
                  <div className="text-[11px]">
                    {formatQuantity(l.quantity)} {unit} x {plainMoney(l.unitPriceIncTax)}
                  </div>
                  {nonZero(l.lineDiscountAmount) && (
                    <div className="text-[11px]">
                      {t('discount')}: {l.lineDiscountType === 'percentage' ? `${formatPercent(l.lineDiscountAmount)}%` : plainMoney(l.lineDiscountAmount)}
                    </div>
                  )}
                  {l.sellLineNote && <div className="text-[11px] italic">{l.sellLineNote}</div>}
                </td>
                <td className="whitespace-nowrap pb-1 text-end font-medium">{plainMoney(l.lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Rule />
      <dl className="space-y-0.5">
        <Pair label={`${t('items')} ${lines.length}`} value="" />
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
        <div className="flex justify-between gap-2 border-t border-black pt-1 text-[14px] font-bold">
          <dt>{t('total')}</dt>
          <dd className="whitespace-nowrap">{formatMoney(totals.finalTotal)}</dd>
        </div>
      </dl>

      {isFinal && (
        <>
          <Rule />
          <dl className="space-y-0.5">
            {paid.map((p) => (
              <Pair key={p.id} label={data.methodLabel(p.method)} value={formatMoney(p.amount)} />
            ))}
            {changeUnits > BigInt(0) && <Pair label={t('change')} value={formatMoney(fromUnits(changeUnits))} />}
            <Pair label={t('totalPaid')} value={formatMoney(totals.totalPaid)} bold />
            {nonZero(totals.totalDue) && <Pair label={t('balanceDue')} value={formatMoney(totals.totalDue)} bold />}
          </dl>
        </>
      )}

      {sale.saleNote && (
        <>
          <Rule />
          <p className="whitespace-pre-wrap">{sale.saleNote}</p>
        </>
      )}

      <Rule />
      <p className="text-center">{t('thankYou')}</p>
    </div>
  );
}

function Rule() {
  return <hr className="my-1.5 border-0 border-t border-dashed border-black" />;
}

function Pair({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap text-end">{value}</dd>
    </div>
  );
}
