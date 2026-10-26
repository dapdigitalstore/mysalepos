'use client';

import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/utils';
import { formatQuantity, useDateTimeFormatter } from './register-format';
import type { PaymentMethodKey, PaymentTypeInfo, RegisterDetails } from './register-types';

/** Name of a payment method: the business's own label for custom ones, else the translated standard name. */
export function useMethodLabel() {
  const t = useTranslations('cashRegister');
  return (p: { method: PaymentMethodKey; label?: string | null }): string => {
    if (p.label) return p.label;
    return p.method.startsWith('custom_pay_') ? t('methods.custom', { n: p.method.slice('custom_pay_'.length) }) : t(`methods.${p.method}`);
  };
}

/** Laravel lists cash, cheque, card, bank transfer, advance, the custom methods and "other" last. */
function screenOrder(types: PaymentTypeInfo[]): PaymentTypeInfo[] {
  const rank = (m: PaymentMethodKey) => {
    if (m === 'cash') return 0;
    if (m === 'cheque') return 1;
    if (m === 'card') return 2;
    if (m === 'bank_transfer') return 3;
    if (m === 'advance') return 4;
    if (m === 'other') return 99;
    return 10 + Number(m.slice('custom_pay_'.length));
  };
  return [...types].sort((a, b) => rank(a.method) - rank(b.method));
}

const num = (v: string) => Number(v);

/** Everything the register details screen shows (and prints): who, payments by method, totals, denominations, products sold. */
export function RegisterSummary({ data }: { data: RegisterDetails }) {
  const t = useTranslations('cashRegister');
  const label = useMethodLabel();
  const fmt = useDateTimeFormatter(data.timeZone);
  const { register, totals, shift } = data;
  const byMethod = new Map(totals.methods.map((m) => [m.method, m]));
  const refunds = totals.methods.filter((m) => num(m.refund) !== 0);
  const typeLabel = new Map(data.paymentTypes.map((p) => [p.method, p]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <dl className="space-y-1">
          <Row term={t('user')} value={register.userName || '-'} />
          <Row term={t('email')} value={register.email ?? '-'} />
          <Row term={t('locationLabel')} value={register.locationName ?? '-'} />
        </dl>
        <dl className="space-y-1">
          <Row term={t('openedAt')} value={fmt(register.openedAt)} />
          <Row term={t('closedAt')} value={register.closedAt ? fmt(register.closedAt) : t('statusOpen')} />
          {register.status === 'close' && <Row term={t('closingAmount')} value={formatMoney(register.closingAmount)} />}
          {register.status === 'close' && <Row term={t('totalCardSlips')} value={String(register.totalCardSlips)} />}
          {register.status === 'close' && <Row term={t('totalCheques')} value={String(register.totalCheques)} />}
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-2 pe-3 text-start font-semibold">
                {t('paymentMethod')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">
                {t('sale')}
              </th>
              <th scope="col" className="py-2 ps-3 text-end font-semibold">
                {t('expense')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-2 pe-3 text-slate-700">{t('cashInHand')}</td>
              <td className="px-3 py-2 text-end tabular-nums">{formatMoney(totals.cashInHand)}</td>
              <td className="py-2 ps-3 text-end text-slate-400">--</td>
            </tr>
            {screenOrder(data.paymentTypes).map((p) => {
              const m = byMethod.get(p.method);
              return (
                <tr key={p.method}>
                  <td className="py-2 pe-3 text-slate-700">{label(typeLabel.get(p.method) ?? p)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatMoney(m?.sale ?? 0)}</td>
                  <td className="py-2 ps-3 text-end tabular-nums">{formatMoney(m?.expense ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
        <Total term={t('totalSales')} value={formatMoney(totals.totalSale)} />
        <div className="flex items-start justify-between gap-3 bg-red-50 px-3 py-2">
          <dt className="font-semibold text-red-800">{t('totalRefund')}</dt>
          <dd className="text-end">
            <div className="font-semibold tabular-nums text-red-800">{formatMoney(totals.totalRefund)}</div>
            {refunds.map((m) => (
              <div key={m.method} className="text-xs text-red-700">
                {label(typeLabel.get(m.method) ?? m)}: {formatMoney(m.refund)}
              </div>
            ))}
          </dd>
        </div>
        <Total term={t('totalPayment')} value={formatMoney(totals.totalPayment)} tone="good" />
        <Total term={t('creditSales')} value={formatMoney(totals.creditSales)} tone="good" />
        <Total term={t('totalSales')} value={formatMoney(totals.shiftSales)} tone="good" />
        <Total term={t('totalExpense')} value={formatMoney(totals.totalExpense)} tone="bad" />
      </dl>

      <p className="text-sm text-slate-600">
        {t('formula', {
          opening: formatMoney(totals.cashInHand),
          sale: formatMoney(totals.grossSale),
          refund: formatMoney(totals.totalRefund),
          expense: formatMoney(totals.totalExpense),
          total: formatMoney(totals.expectedTotal),
        })}
      </p>

      {register.denominations.length > 0 && (
        <section aria-label={t('denominations')}>
          <h3 className="mb-2 text-base font-semibold text-slate-900">{t('denominations')}</h3>
          <table className="w-full max-w-lg text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 text-end font-semibold">
                  {t('denomination')}
                </th>
                <th scope="col" className="px-3 py-2 text-center font-semibold">
                  {t('count')}
                </th>
                <th scope="col" className="py-2 text-end font-semibold">
                  {t('subtotal')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {register.denominations.map((r) => (
                <tr key={r.denomination}>
                  <td className="py-1.5 text-end tabular-nums">{formatQuantity(r.denomination)}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">x {r.count}</td>
                  <td className="py-1.5 text-end tabular-nums">{formatMoney(r.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td colSpan={2} className="py-2 text-end">
                  {t('total')}
                </td>
                <td className="py-2 text-end tabular-nums">{formatMoney(register.denominationsTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {register.closingNote && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-semibold text-slate-700">{t('closingNote')}</div>
          <p className="mt-1 whitespace-pre-wrap text-slate-600">{register.closingNote}</p>
        </div>
      )}

      <ProductTable
        title={t('productsSold')}
        head={[t('sku'), t('product'), t('quantity'), t('totalAmount')]}
        rows={shift.products.map((p, i) => ({
          key: `${i}-${p.sku ?? ''}`,
          cells: [
            p.sku ?? '',
            p.productType === 'variable' ? `${p.productName} ${p.productVariationName ?? ''} - ${p.variationName ?? ''}` : p.productName,
            formatQuantity(p.quantity),
            formatMoney(p.amount),
          ],
        }))}
        quantity={shift.productsQuantity}
        shift={shift}
        grand={shift.productsGrandTotal}
      />
      <ProductTable
        title={t('productsSoldByBrand')}
        head={[t('brand'), t('quantity'), t('totalAmount')]}
        rows={shift.brands.map((b, i) => ({ key: `${i}-${b.brandName ?? ''}`, cells: [b.brandName ?? t('noBrand'), formatQuantity(b.quantity), formatMoney(b.amount)] }))}
        quantity={shift.brandsQuantity}
        shift={shift}
        grand={shift.brandsGrandTotal}
      />

      {shift.typesOfService && shift.typesOfService.length > 0 && (
        <section aria-label={t('typesOfService')}>
          <h3 className="mb-2 text-base font-semibold text-slate-900">{t('typesOfService')}</h3>
          <table className="w-full max-w-lg text-sm">
            <tbody className="divide-y divide-slate-100">
              {shift.typesOfService.map((s, i) => (
                <tr key={`${i}-${s.name ?? ''}`}>
                  <td className="py-1.5">{s.name ?? t('noService')}</td>
                  <td className="py-1.5 text-end tabular-nums">{formatMoney(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="font-medium text-slate-500">{term}:</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

function Total({ term, value, tone }: { term: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 ${tone === 'good' ? 'bg-emerald-50' : tone === 'bad' ? 'bg-red-50' : ''}`}>
      <dt className="font-medium text-slate-700">{term}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

interface TableProps {
  title: string;
  head: string[];
  rows: { key: string; cells: string[] }[];
  quantity: string;
  grand: string;
  shift: RegisterDetails['shift'];
}

/** Products sold during the shift with the tax / discount / shipping lines under the table, like the Laravel register_product_details view. */
function ProductTable({ title, head, rows, quantity, grand, shift }: TableProps) {
  const t = useTranslations('cashRegister');
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-base font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t('noProducts')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pe-2 text-start font-semibold">
                  #
                </th>
                {head.map((h, i) => (
                  <th key={h} scope="col" className={`py-2 font-semibold ${i >= head.length - 2 ? 'px-2 text-end' : 'px-2 text-start'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="py-1.5 pe-2 text-slate-400">{i + 1}.</td>
                  {r.cells.map((c, j) => (
                    <td key={j} className={`px-2 py-1.5 ${j >= r.cells.length - 2 ? 'text-end tabular-nums' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-emerald-50 align-top font-semibold">
                <td className="py-2 pe-2">#</td>
                <td colSpan={head.length - 2} className="px-2 py-2" />
                <td className="px-2 py-2 text-end tabular-nums">{formatQuantity(quantity)}</td>
                <td className="px-2 py-2 text-end font-semibold">
                  {num(shift.totalTax) !== 0 && (
                    <div>
                      {t('orderTax')}: (+) {formatMoney(shift.totalTax)}
                    </div>
                  )}
                  {num(shift.totalDiscount) !== 0 && (
                    <div>
                      {t('discount')}: (-) {formatMoney(shift.totalDiscount)}
                    </div>
                  )}
                  {num(shift.totalShippingCharges) !== 0 && (
                    <div>
                      {t('shipping')}: (+) {formatMoney(shift.totalShippingCharges)}
                    </div>
                  )}
                  <div>
                    {t('grandTotal')}: {formatMoney(grand)}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
