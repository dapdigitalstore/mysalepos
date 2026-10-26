'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { fromUnits, inputToInstant, instantToInput, toFieldValue, toUnits } from './format';
import type { PaymentDefaults, SalePayment } from './sale-types';
import { BASE_PAYMENT_METHODS } from './sale-types';
import { useBusiness, usePosSettings } from './use-business';

const CARD_TYPES = ['credit', 'debit', 'visa', 'master'] as const;

/** Payment methods the dialog offers: the business list from pos-settings, else the standard five. */
export function usePaymentMethods(withAdvance: boolean): { key: string; label: string }[] {
  const t = useTranslations('sales');
  const settings = usePosSettings();
  const base = settings.data?.paymentMethods ?? BASE_PAYMENT_METHODS.map((k) => ({ key: k, label: k }));
  const methods = base.map((m) => ({ key: m.key, label: labelOfMethod(m.key, m.label, t) }));
  if (withAdvance && !methods.some((m) => m.key === 'advance')) methods.push({ key: 'advance', label: t('method_advance') });
  return methods;
}

type T = ReturnType<typeof useTranslations>;

/** Standard methods are translated; `custom_pay_N` keeps the label the business gave it. */
function labelOfMethod(key: string, serverLabel: string | undefined, t: T): string {
  if ((BASE_PAYMENT_METHODS as readonly string[]).includes(key) || key === 'advance') return t(`method_${key}`);
  if (key.startsWith('custom_pay_')) return serverLabel || t('method_custom', { n: key.slice('custom_pay_'.length) });
  return serverLabel || key;
}

/** Label of a stored payment method, for tables and print views. */
export function useMethodLabel() {
  const t = useTranslations('sales');
  const settings = usePosSettings();
  const labels = new Map((settings.data?.paymentMethods ?? []).map((m) => [m.key, m.label]));
  return (key: string | null | undefined) => (key ? labelOfMethod(key, labels.get(key), t) : '-');
}

interface Props {
  saleId: number;
  /** Set to edit an existing payment (PUT /sale-payments/:id); otherwise a new payment is added. */
  payment?: SalePayment;
  /** Customer's advance balance: the "advance" method is offered only when it is positive. */
  advanceBalance?: string | null;
  onClose: () => void;
}

/** Add payment (default amount = the due, from /payment-defaults) or edit one. Laravel: transaction_payment/add_payment + edit_payment. */
export function PaymentDialog({ saleId, payment, advanceBalance, onClose }: Props) {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const editing = !!payment;
  const defaults = useQuery({
    queryKey: ['sales', 'payment-defaults', saleId],
    queryFn: () => api<PaymentDefaults>(`/sales/${saleId}/payment-defaults`),
    enabled: !editing,
    gcTime: 0,
    staleTime: 0,
  });

  return (
    <Dialog open onClose={onClose} title={editing ? t('payEditTitle') : t('payAddTitle')} className="max-w-xl">
      {!editing && defaults.isLoading && (
        <div aria-busy="true" className="space-y-3">
          <div className="h-10 animate-pulse rounded bg-slate-100" />
          <div className="h-10 animate-pulse rounded bg-slate-100" />
        </div>
      )}
      {!editing && defaults.isError && (
        <div role="alert" className="space-y-3 text-sm text-red-700">
          <p>{defaults.error instanceof ApiError && defaults.error.messages[0] ? defaults.error.messages[0] : c('loadError')}</p>
          <Button variant="outline" onClick={() => void defaults.refetch()}>
            {c('retry')}
          </Button>
        </div>
      )}
      {!editing && defaults.data && defaults.data.status === 'closed' && <p className="text-sm text-slate-600">{t('payNothingDue')}</p>}
      {!editing && defaults.data && defaults.data.status !== 'closed' && <PaymentForm saleId={saleId} defaults={defaults.data} advanceBalance={advanceBalance} onClose={onClose} />}
      {editing && payment && <PaymentForm saleId={saleId} payment={payment} advanceBalance={advanceBalance} onClose={onClose} />}
    </Dialog>
  );
}

function PaymentForm({ saleId, defaults, payment, advanceBalance, onClose }: { saleId: number; defaults?: PaymentDefaults; payment?: SalePayment; advanceBalance?: string | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const { timeZone } = useBusiness();
  const settings = usePosSettings();
  const accounts = settings.data?.accounts ?? [];
  const hasAdvance = (toUnits(advanceBalance ?? '0') ?? BigInt(0)) > BigInt(0) || payment?.method === 'advance';
  const methods = usePaymentMethods(hasAdvance);
  const due = defaults?.amount ?? null;
  const dueUnits = due === null ? null : toUnits(due);

  const schema = z
    .object({
      method: z.string().min(1),
      amount: z.string().trim(),
      paidOn: z.string(),
      note: z.string().trim().max(5000),
      cardTransactionNumber: z.string().trim().max(191),
      cardNumber: z.string().trim().max(191),
      cardHolderName: z.string().trim().max(191),
      cardType: z.string().trim().max(191),
      cardMonth: z.string().trim().max(191),
      cardYear: z.string().trim().max(191),
      cardSecurity: z.string().trim().max(5),
      chequeNumber: z.string().trim().max(191),
      bankAccountNumber: z.string().trim().max(191),
      transactionNo: z.string().trim().max(191),
      accountId: z.string(),
    })
    .superRefine((v, ctx) => {
      const a = toUnits(v.amount);
      if (a === null || a <= BigInt(0)) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'number' });
      else if (dueUnits !== null && a > dueUnits) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'max' });
    });
  type Values = z.infer<typeof schema>;

  const initial: Values = payment
    ? {
        method: payment.method ?? 'cash',
        amount: toFieldValue(payment.amount),
        paidOn: instantToInput(payment.paidOn, timeZone),
        note: payment.note ?? '',
        cardTransactionNumber: payment.cardTransactionNumber ?? '',
        cardNumber: payment.cardNumber ?? '',
        cardHolderName: payment.cardHolderName ?? '',
        cardType: payment.cardType ?? '',
        cardMonth: payment.cardMonth ?? '',
        cardYear: payment.cardYear ?? '',
        cardSecurity: '',
        chequeNumber: payment.chequeNumber ?? '',
        bankAccountNumber: payment.bankAccountNumber ?? '',
        transactionNo: payment.transactionNo ?? '',
        accountId: payment.accountId ? String(payment.accountId) : '',
      }
    : {
        method: defaults?.method ?? 'cash',
        amount: toFieldValue(defaults?.amount ?? '0'),
        paidOn: instantToInput(defaults?.paidOn ?? new Date().toISOString(), timeZone),
        note: '',
        cardTransactionNumber: '',
        cardNumber: '',
        cardHolderName: '',
        cardType: '',
        cardMonth: '',
        cardYear: '',
        cardSecurity: '',
        chequeNumber: '',
        bankAccountNumber: '',
        transactionNo: '',
        accountId: '',
      };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const method = useWatch({ control, name: 'method' });

  const save = useMutation({
    mutationFn: (v: Values) => {
      // On edit an empty string clears the stored value; on add empty fields are simply left out.
      const editing = !!payment;
      const field = (relevant: boolean, value: string): string | undefined => (relevant ? value : '') || (editing ? '' : undefined);
      const isCard = v.method === 'card';
      const body = {
        method: v.method,
        amount: toFieldValue(v.amount),
        paidOn: inputToInstant(v.paidOn, timeZone),
        note: v.note || (editing ? '' : undefined),
        cardTransactionNumber: field(isCard, v.cardTransactionNumber),
        cardNumber: field(isCard, v.cardNumber),
        cardHolderName: field(isCard, v.cardHolderName),
        cardType: field(isCard, v.cardType),
        cardMonth: field(isCard, v.cardMonth),
        cardYear: field(isCard, v.cardYear),
        cardSecurity: isCard && v.cardSecurity ? v.cardSecurity : undefined,
        chequeNumber: field(v.method === 'cheque', v.chequeNumber),
        bankAccountNumber: field(v.method === 'bank_transfer', v.bankAccountNumber),
        transactionNo: field(v.method.startsWith('custom_pay_'), v.transactionNo),
        accountId: v.method !== 'advance' && v.accountId ? Number(v.accountId) : editing ? null : undefined,
      };
      return payment
        ? api(`/sale-payments/${payment.id}`, { method: 'PUT', body })
        : api(`/sales/${saleId}/payments`, { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success(payment ? t('payUpdated') : t('paySaved'));
      void qc.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const maxHint = due !== null ? t('payDueHint', { amount: formatMoney(fromUnits(dueUnits ?? BigInt(0))) }) : undefined;
  const amountError = errors.amount ? (errors.amount.message === 'max' ? maxHint : t('payAmountInvalid')) : undefined;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="max-h-[75vh] space-y-4 overflow-y-auto pe-1">
      {defaults && (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">{t('payInvoice')}</dt>
            <dd className="font-medium text-slate-900">{defaults.invoiceNo ?? `#${defaults.saleId}`}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('payTotal')}</dt>
            <dd className="font-medium text-slate-900">{formatMoney(defaults.finalTotal)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('payPaidSoFar')}</dt>
            <dd className="font-medium text-slate-900">{formatMoney(defaults.totalPaid)}</dd>
          </div>
        </dl>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('payAmount')} htmlFor="pay-amount" required hint={maxHint} error={amountError}>
          <Input id="pay-amount" {...register('amount')} inputMode="decimal" autoComplete="off" className="text-end" autoFocus />
        </Field>
        <Field label={t('payDate')} htmlFor="pay-date">
          <Input id="pay-date" type="datetime-local" {...register('paidOn')} />
        </Field>
        <Field label={t('payMethod')} htmlFor="pay-method" required>
          <Select id="pay-method" {...register('method')}>
            {methods.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
            {!methods.some((m) => m.key === method) && <option value={method}>{method}</option>}
          </Select>
        </Field>
        {accounts.length > 0 && method !== 'advance' && (
          <Field label={t('payAccount')} htmlFor="pay-account">
            <Select id="pay-account" {...register('accountId')}>
              <option value="">{t('payNoAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {method === 'card' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('payCardNumber')} htmlFor="pay-card-number">
            <Input id="pay-card-number" {...register('cardNumber')} autoComplete="off" inputMode="numeric" />
          </Field>
          <Field label={t('payCardHolder')} htmlFor="pay-card-holder">
            <Input id="pay-card-holder" {...register('cardHolderName')} autoComplete="off" />
          </Field>
          <Field label={t('payCardTransaction')} htmlFor="pay-card-tx">
            <Input id="pay-card-tx" {...register('cardTransactionNumber')} autoComplete="off" />
          </Field>
          <Field label={t('payCardType')} htmlFor="pay-card-type">
            <Select id="pay-card-type" {...register('cardType')}>
              <option value="">-</option>
              {CARD_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`cardType_${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('payCardMonth')} htmlFor="pay-card-month">
            <Input id="pay-card-month" {...register('cardMonth')} autoComplete="off" inputMode="numeric" maxLength={2} />
          </Field>
          <Field label={t('payCardYear')} htmlFor="pay-card-year">
            <Input id="pay-card-year" {...register('cardYear')} autoComplete="off" inputMode="numeric" maxLength={4} />
          </Field>
          <Field label={t('payCardSecurity')} htmlFor="pay-card-security">
            <Input id="pay-card-security" {...register('cardSecurity')} autoComplete="off" inputMode="numeric" maxLength={5} />
          </Field>
        </div>
      )}
      {method === 'cheque' && (
        <Field label={t('payChequeNumber')} htmlFor="pay-cheque">
          <Input id="pay-cheque" {...register('chequeNumber')} autoComplete="off" />
        </Field>
      )}
      {method === 'bank_transfer' && (
        <Field label={t('payBankAccount')} htmlFor="pay-bank">
          <Input id="pay-bank" {...register('bankAccountNumber')} autoComplete="off" />
        </Field>
      )}
      {method.startsWith('custom_pay_') && (
        <Field label={t('payTransactionNo')} htmlFor="pay-tx">
          <Input id="pay-tx" {...register('transactionNo')} autoComplete="off" />
        </Field>
      )}

      <Field label={t('payNote')} htmlFor="pay-note">
        <Textarea id="pay-note" {...register('note')} />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          {c('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? c('saving') : t('paySave')}
        </Button>
      </div>
    </form>
  );
}
