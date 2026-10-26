'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { cmp, parseDec, toFixed } from './decimal-math';

const METHODS = ['cash', 'card', 'cheque', 'bank_transfer', 'other', 'advance'] as const;

/** Local date-time for <input type="datetime-local">. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Refund paid to the customer for a return (Laravel: Add payment on the sell return row). */
export function PaymentDialog({ returnId, due, onClose }: { returnId: number; due: string; onClose: () => void }) {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();

  const schema = z
    .object({
      amount: z.string().trim(),
      method: z.enum(METHODS),
      paidOn: z.string(),
      note: z.string().trim().max(1000),
      chequeNumber: z.string().trim().max(191),
      bankAccountNumber: z.string().trim().max(191),
      cardTransactionNumber: z.string().trim().max(191),
    })
    .superRefine((v, ctx) => {
      const a = parseDec(v.amount);
      const max = parseDec(due);
      if (!a || a.n <= BigInt(0) || a.s > 4) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'number' });
      else if (max && cmp(a, max) > 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'max' });
    });
  type Values = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: toFixed(parseDec(due) ?? { n: BigInt(0), s: 0 }, 2), method: 'cash', paidOn: nowLocal(), note: '', chequeNumber: '', bankAccountNumber: '', cardTransactionNumber: '' },
  });
  const method = useWatch({ control, name: 'method' });

  const save = useMutation({
    mutationFn: (v: Values) =>
      api(`/sell-returns/${returnId}/payments`, {
        method: 'POST',
        body: {
          amount: Number(toFixed(parseDec(v.amount) ?? { n: BigInt(0), s: 0 }, 4)),
          method: v.method,
          paidOn: v.paidOn ? new Date(v.paidOn).toISOString() : undefined,
          note: v.note || undefined,
          chequeNumber: v.method === 'cheque' ? v.chequeNumber || undefined : undefined,
          bankAccountNumber: v.method === 'bank_transfer' ? v.bankAccountNumber || undefined : undefined,
          cardTransactionNumber: v.method === 'card' ? v.cardTransactionNumber || undefined : undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t('paySaved'));
      void qc.invalidateQueries({ queryKey: ['sell-returns'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  return (
    <Dialog open onClose={onClose} title={t('addPayment')}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
        <Field
          label={t('payAmount')}
          htmlFor="pay-amount"
          required
          hint={t('payDueHint', { amount: formatMoney(due) })}
          error={errors.amount ? (errors.amount.message === 'max' ? t('payDueHint', { amount: formatMoney(due) }) : c('required')) : undefined}
        >
          <Input id="pay-amount" {...register('amount')} inputMode="decimal" autoComplete="off" className="text-end" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('payMethod')} htmlFor="pay-method" required>
            <Select id="pay-method" {...register('method')}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`method_${m}` as 'method_cash')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('payDate')} htmlFor="pay-date">
            <Input id="pay-date" type="datetime-local" {...register('paidOn')} />
          </Field>
        </div>
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
        {method === 'card' && (
          <Field label={t('payTransactionNo')} htmlFor="pay-card">
            <Input id="pay-card" {...register('cardTransactionNumber')} autoComplete="off" />
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
    </Dialog>
  );
}
