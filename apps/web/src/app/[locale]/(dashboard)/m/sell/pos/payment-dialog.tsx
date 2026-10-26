'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn, formatMoney } from '@/lib/utils';
import { newPaymentRow, type PaymentRow, type PaymentsInput } from '../_lib/cart';
import { dec, isPos, isZero, toFixed, toText, type Dec } from '../_lib/decimal';
import { cashSuggestions, summarizePayments } from '../_lib/sale-math';
import type { PaymentMethodOption, SaleLocation, SaleSettings } from '../_lib/sale-types';
import { PaymentRows } from '../_components/payment-rows';
import { SHORTCUTS, prettyCombo, shortcutFor } from '../_lib/shortcuts';
import type { CartTotals } from '../_lib/cart';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: SaleSettings;
  location: SaleLocation | null;
  customerName: string;
  isWalkIn: boolean;
  advanceBalance: string | null;
  totals: CartTotals;
  /** Rows to start from: the stored payments of a sale being edited, otherwise empty (a cash row for the total is added). */
  initialRows: PaymentRow[];
  changePaymentId: number | null;
  busy: boolean;
  error: string | null;
  onSubmit: (input: PaymentsInput) => void;
  onCredit: () => void;
}

/** Methods of the POS location (falls back to every method the business has, cash always works). */
export function methodsFor(settings: SaleSettings, location: SaleLocation | null): PaymentMethodOption[] {
  const own = location?.paymentMethods ?? [];
  const list = own.length > 0 ? own : settings.paymentMethods;
  return list.length > 0 ? list : [{ key: 'cash', label: 'Cash' }];
}

export function PaymentDialog({ open, onClose, settings, location, customerName, isWalkIn, advanceBalance, totals, initialRows, changePaymentId, busy, error, onSubmit, onCredit }: Props) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const cp = settings.business.currencyPrecision;
  const methods = useMemo(() => methodsFor(settings, location), [settings, location]);
  const total = totals.finalTotal;
  const [rows, setRows] = useState<PaymentRow[]>([]);

  // each time the dialog opens: the stored payments, or one cash row for the whole total
  useEffect(() => {
    if (!open) return;
    if (initialRows.length > 0) {
      setRows(initialRows);
      return;
    }
    const cash = methods.find((m) => m.key === 'cash') ?? methods[0];
    setRows([newPaymentRow(cash.key, isPos(total) ? toText(total) : '', cash.accountId ?? null)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the native dialog moves focus to its close button when it opens: put it on the first amount
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const el = document.getElementById('pos-pay-amount-0') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 80);
    return () => clearTimeout(id);
  }, [open]);

  const summary = summarizePayments(total, rows.map((r) => r.amount));
  const money = (d: Dec) => formatMoney(toFixed(d, cp));
  const suggestions = cashSuggestions(total);
  const nothingEntered = rows.every((r) => isZero(dec(r.amount)));

  const setCash = (amount: Dec) => {
    const idx = rows.findIndex((r) => r.method === 'cash');
    if (idx >= 0) setRows(rows.map((r, i) => (i === idx ? { ...r, amount: toText(amount) } : r)));
    else {
      const cash = methods.find((m) => m.key === 'cash');
      if (cash) setRows([...rows, newPaymentRow('cash', toText(amount), cash.accountId ?? null)]);
    }
  };

  const finalize = () => {
    if (busy) return;
    onSubmit({ rows, change: summary.change, changePaymentId });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const id = shortcutFor(e.nativeEvent, ['finalize', 'addPayment']);
    if (id === 'finalize') {
      e.preventDefault();
      finalize();
    } else if (id === 'addPayment') {
      e.preventDefault();
      document.getElementById('pos-pay-add')?.click();
    }
  };

  const hasCash = methods.some((m) => m.key === 'cash');

  return (
    <Dialog open={open} onClose={onClose} title={t('paymentTitle')} className="max-w-2xl">
      <div onKeyDown={onKeyDown} className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2 rounded-lg bg-primary-light/50 p-3">
          <div>
            <p className="text-xs text-slate-600">{t('customer')}</p>
            <p className="text-sm font-medium text-slate-900">{customerName}</p>
          </div>
          <div className="text-end">
            <p className="text-xs text-slate-600">{t('totalPayable')}</p>
            <p className="text-3xl font-bold text-primary-dark">{money(total)}</p>
          </div>
        </div>

        {hasCash && suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('quickCash')}>
            <span className="text-xs text-slate-500">{t('quickCash')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setCash(total)}>
              {t('exact')}
            </Button>
            {suggestions.map((s) => (
              <Button key={toText(s)} type="button" variant="outline" size="sm" onClick={() => setCash(s)}>
                {formatMoney(toFixed(s, 0))}
              </Button>
            ))}
          </div>
        )}

        <PaymentRows
          rows={rows}
          onChange={setRows}
          methods={methods}
          accounts={settings.accounts}
          total={total}
          currencyPrecision={cp}
          advanceBalance={advanceBalance}
          idPrefix="pos-pay"
          autoFocusFirst
        />

        <div className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3" aria-live="polite">
          <Cell label={t('tendered')} value={money(summary.tendered)} />
          <Cell label={t('balanceDue')} value={money(summary.balance)} tone={isPos(summary.balance) ? 'bad' : 'plain'} />
          <Cell label={t('changeDue')} value={money(summary.change)} tone={isPos(summary.change) ? 'good' : 'plain'} />
        </div>

        {isPos(summary.balance) && !nothingEntered && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {summary.status === 'partial' ? t('partialNote', { amount: money(summary.balance) }) : t('dueNote')}
            {isWalkIn && ` ${t('walkInDueNote')}`}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onCredit} disabled={busy || isWalkIn} title={isWalkIn ? t('creditNeedsCustomer') : t('creditHint')}>
            {t('creditSale')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {c('cancel')}
            </Button>
            <Button type="button" size="lg" onClick={finalize} disabled={busy} title={prettyCombo(SHORTCUTS.finalize)}>
              {busy ? c('saving') : t('finalize')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Cell({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'good' | 'bad' }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn('text-base font-semibold', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-800')}>{value}</p>
    </div>
  );
}
