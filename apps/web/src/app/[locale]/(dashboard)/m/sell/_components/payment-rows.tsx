'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/utils';
import { newPaymentRow, type PaymentRow } from '../_lib/cart';
import { dec, isPos, toFixed, toText, type Dec } from '../_lib/decimal';
import { remainingForRow } from '../_lib/sale-math';
import type { PaymentMethodOption } from '../_lib/sale-types';

interface Props {
  rows: PaymentRow[];
  onChange: (rows: PaymentRow[]) => void;
  methods: PaymentMethodOption[];
  accounts: { id: number; name: string }[];
  total: Dec;
  currencyPrecision: number;
  /** The customer's advance balance; the `advance` method is offered only when it is above zero. */
  advanceBalance: string | null;
  /** Id prefix so two editors on one page do not share DOM ids. */
  idPrefix: string;
  /** Focus target for the first amount (the dialog focuses it when it opens). */
  autoFocusFirst?: boolean;
}

const numeric = (v: string): string => v.replace(/[^\d.]/g, '');

/** Payment rows of a sale: method, amount, optional method details, account. New rows start at what is still unpaid. */
export function PaymentRows({ rows, onChange, methods, accounts, total, currencyPrecision, advanceBalance, idPrefix, autoFocusFirst }: Props) {
  const t = useTranslations('pos');
  const hasAdvance = advanceBalance !== null && isPos(dec(advanceBalance));
  const options = hasAdvance || rows.some((r) => r.method === 'advance') ? [...methods, { key: 'advance', label: t('methodAdvance') }] : methods;
  const defaultMethod = methods.find((m) => m.key === 'cash')?.key ?? methods[0]?.key ?? 'cash';

  const patch = (key: string, p: Partial<PaymentRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const amounts = rows.map((r) => r.amount);

  const addRow = () => {
    const missing = remainingForRow(total, amounts, -1);
    const used = new Set(rows.map((r) => r.method));
    const method = rows.length === 0 ? defaultMethod : (methods.find((m) => !used.has(m.key))?.key ?? defaultMethod);
    onChange([...rows, newPaymentRow(method, isPos(missing) ? toText(missing) : '', methods.find((m) => m.key === method)?.accountId ?? null)]);
  };

  const label = (key: string): string => options.find((m) => m.key === key)?.label ?? key;

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <fieldset key={r.key} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">{t('paymentN', { n: i + 1 })}</legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={t('paymentMethod')} htmlFor={`${idPrefix}-method-${i}`}>
              <Select
                id={`${idPrefix}-method-${i}`}
                value={r.method}
                onChange={(e) => {
                  const m = options.find((x) => x.key === e.target.value);
                  patch(r.key, { method: e.target.value, accountId: m?.accountId ?? r.accountId });
                }}
              >
                {options.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
                {!options.some((m) => m.key === r.method) && <option value={r.method}>{label(r.method)}</option>}
              </Select>
            </Field>
            <Field label={t('amount')} htmlFor={`${idPrefix}-amount-${i}`}>
              <div className="flex gap-2">
                <Input
                  id={`${idPrefix}-amount-${i}`}
                  value={r.amount}
                  onChange={(e) => patch(r.key, { amount: numeric(e.target.value) })}
                  inputMode="decimal"
                  autoFocus={autoFocusFirst && i === 0}
                  onFocus={(e) => e.currentTarget.select()}
                  className="text-end text-base font-semibold"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => patch(r.key, { amount: toText(remainingForRow(total, amounts, i)) })}
                  title={t('exactHint', { amount: formatMoney(toFixed(remainingForRow(total, amounts, i), currencyPrecision)) })}
                >
                  {t('exact')}
                </Button>
              </div>
            </Field>
            <div className="flex items-end">
              <Button type="button" variant="ghost" className="h-11 w-11 px-0 text-slate-400 hover:text-red-600" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label={t('removePayment', { n: i + 1 })}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <MethodDetails row={r} idPrefix={`${idPrefix}-${i}`} onPatch={(p) => patch(r.key, p)} />

          {accounts.length > 0 && r.method !== 'advance' && (
            <Field label={t('account')} htmlFor={`${idPrefix}-account-${i}`} className="mt-3">
              <Select id={`${idPrefix}-account-${i}`} value={r.accountId ?? ''} onChange={(e) => patch(r.key, { accountId: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">{t('noAccount')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {r.method === 'advance' && hasAdvance && <p className="mt-2 text-xs text-emerald-700">{t('advanceAvailable', { amount: formatMoney(advanceBalance ?? '0') })}</p>}
        </fieldset>
      ))}

      <Button id={`${idPrefix}-add`} type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('addPayment')}
      </Button>
    </div>
  );
}

function MethodDetails({ row, idPrefix, onPatch }: { row: PaymentRow; idPrefix: string; onPatch: (p: Partial<PaymentRow>) => void }) {
  const t = useTranslations('pos');
  const text = (key: keyof PaymentRow, label: string, extra?: { maxLength?: number }) => (
    <Field label={label} htmlFor={`${idPrefix}-${String(key)}`}>
      <Input id={`${idPrefix}-${String(key)}`} value={String(row[key] ?? '')} onChange={(e) => onPatch({ [key]: e.target.value } as Partial<PaymentRow>)} autoComplete="off" maxLength={extra?.maxLength ?? 191} />
    </Field>
  );

  if (row.method === 'card') {
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {text('cardTransactionNumber', t('cardTransactionNumber'))}
        {text('cardNumber', t('cardLast4'), { maxLength: 4 })}
        {text('cardHolderName', t('cardHolderName'))}
        <Field label={t('cardType')} htmlFor={`${idPrefix}-cardType`}>
          <Select id={`${idPrefix}-cardType`} value={row.cardType} onChange={(e) => onPatch({ cardType: e.target.value })}>
            <option value="">-</option>
            <option value="credit">{t('cardCredit')}</option>
            <option value="debit">{t('cardDebit')}</option>
            <option value="visa">Visa</option>
            <option value="master">Mastercard</option>
          </Select>
        </Field>
      </div>
    );
  }
  if (row.method === 'cheque') return <div className="mt-3">{text('chequeNumber', t('chequeNumber'))}</div>;
  if (row.method === 'bank_transfer') return <div className="mt-3">{text('bankAccountNumber', t('bankAccountNumber'))}</div>;
  if (row.method.startsWith('custom_pay_')) return <div className="mt-3">{text('transactionNo', t('transactionNo'))}</div>;
  return null;
}
