'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { PrintStyles } from './print-styles';
import { formatQuantity } from './register-format';
import { RegisterSummary } from './register-summary';
import { useRegisterDetails } from './register-details-view';
import type { RegisterDetails } from './register-types';

const isAmount = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const isCount = (v: string) => /^\d{1,7}$/.test(v.trim());

/** Close register screen (Laravel: cash_register.close_register_modal): summary, closing form, print. */
export function CloseRegisterView({ id }: { id?: number }) {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const q = useRegisterDetails(id);

  const back = (
    <Link href="/m/sell/register" className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
      {t('back')}
    </Link>
  );

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-4xl" aria-busy="true">
        <PageHeader title={t('closeRegister')} actions={back} />
        <Card className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 12}%` }} />
          ))}
        </Card>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t('closeRegister')} actions={back} />
        <Card>
          <p role="alert" className="text-sm text-red-700">
            {c('loadError')}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }

  return <CloseForm id={id} data={q.data} back={back} />;
}

function CloseForm({ id, data, back }: { id?: number; data: RegisterDetails; back: React.ReactNode }) {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const schema = z.object({
    closingAmount: z.string().refine(isAmount, t('amountInvalid')),
    totalCardSlips: z.string().refine(isCount, t('countInvalid')),
    totalCheques: z.string().refine(isCount, t('countInvalid')),
    closingNote: z.string().max(5000),
  });
  type Values = z.infer<typeof schema>;

  const { register, handleSubmit, formState, getValues, trigger } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      closingAmount: data.totals.suggestedClosingAmount,
      totalCardSlips: String(data.totals.cardSlips),
      totalCheques: String(data.totals.cheques),
      closingNote: '',
    },
  });

  const denominations = data.config.denominations;
  const denominationTotal = denominations.reduce((sum, d) => sum + Number(d) * (Number(counts[d]) || 0), 0);

  const close = useMutation({
    mutationFn: (v: Values) => {
      const counted: Record<string, number> = {};
      for (const d of denominations) {
        const n = Number(counts[d]);
        if (Number.isInteger(n) && n > 0) counted[d] = n;
      }
      return api(id === undefined ? '/cash-registers/current/close' : `/cash-registers/${id}/close`, {
        method: 'POST',
        body: {
          closingAmount: v.closingAmount.trim(),
          totalCardSlips: Number(v.totalCardSlips),
          totalCheques: Number(v.totalCheques),
          closingNote: v.closingNote.trim() === '' ? null : v.closingNote.trim(),
          denominations: Object.keys(counted).length > 0 ? counted : null,
        },
      });
    },
    onSuccess: async () => {
      toast.success(t('registerClosed'));
      setConfirming(false);
      await qc.invalidateQueries({ queryKey: ['cash-register'] });
      router.push('/m/sell/register');
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      void qc.invalidateQueries({ queryKey: ['cash-register'] });
    },
  });

  if (data.register.status !== 'open') {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t('closeRegister')} actions={back} />
        <Card>
          <p role="status" className="text-sm text-slate-700">
            {t('alreadyClosed')}
          </p>
          <Link href={id === undefined ? '/m/sell/register' : `/m/sell/register/${id}`} className="mt-3 inline-block text-sm font-medium text-primary-dark hover:underline">
            {t('viewDetails')}
          </Link>
        </Card>
      </div>
    );
  }

  const askConfirm = async () => {
    if (await trigger()) setConfirming(true);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PrintStyles />
      <PageHeader
        title={id === undefined ? t('closeRegister') : t('closeOtherTitle', { id: data.register.id })}
        actions={
          <>
            {back}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              {t('print')}
            </Button>
          </>
        }
      />

      <Card id="register-print-area" className="mb-5">
        <RegisterSummary data={data} />
      </Card>

      <Card>
        <form onSubmit={handleSubmit(() => setConfirming(true))} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('closingAmount')} htmlFor="closing-amount" required hint={t('closingAmountHelp')} error={formState.errors.closingAmount?.message}>
              <Input id="closing-amount" inputMode="decimal" className="h-12 text-lg" {...register('closingAmount')} />
            </Field>
            <Field label={t('totalCardSlips')} htmlFor="card-slips" required hint={t('totalCardSlipsHelp')} error={formState.errors.totalCardSlips?.message}>
              <Input id="card-slips" inputMode="numeric" {...register('totalCardSlips')} />
            </Field>
            <Field label={t('totalCheques')} htmlFor="cheques" required hint={t('totalChequesHelp')} error={formState.errors.totalCheques?.message}>
              <Input id="cheques" inputMode="numeric" {...register('totalCheques')} />
            </Field>
          </div>

          <section aria-labelledby="denominations-heading">
            <h3 id="denominations-heading" className="text-base font-semibold text-slate-900">
              {t('denominations')}
            </h3>
            {denominations.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">{t('noDenominationsConfigured')}</p>
            ) : (
              <>
                <p className="mb-2 mt-1 text-sm text-slate-500">{t('denominationsHelp')}</p>
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
                    {denominations.map((d) => (
                      <tr key={d}>
                        <td className="py-1.5 text-end tabular-nums">{formatQuantity(d)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`${t('count')} ${formatQuantity(d)}`}
                            className="mx-auto h-9 w-28 text-center"
                            value={counts[d] ?? ''}
                            onChange={(e) => setCounts((cur) => ({ ...cur, [d]: e.target.value }))}
                          />
                        </td>
                        <td className="py-1.5 text-end tabular-nums">{formatMoney(Number(d) * (Number(counts[d]) || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 font-semibold">
                      <td colSpan={2} className="py-2 text-end">
                        {t('total')}
                      </td>
                      <td className="py-2 text-end tabular-nums">{formatMoney(denominationTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </section>

          <Field label={t('closingNote')} htmlFor="closing-note" error={formState.errors.closingNote?.message}>
            <Textarea id="closing-note" rows={3} {...register('closingNote')} />
          </Field>

          <div className="flex justify-end">
            <Button type="button" size="lg" className="bg-red-600 hover:bg-red-700" onClick={() => void askConfirm()} disabled={close.isPending}>
              <Lock className="h-4 w-4" />
              {t('closeRegister')}
            </Button>
          </div>
        </form>
      </Card>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={t('confirmCloseTitle')} className="max-w-sm">
        <p className="text-sm text-slate-600">{t('confirmCloseBody')}</p>
        <p className="mt-3 text-sm font-medium text-slate-800">
          {t('closingAmount')}: {formatMoney(getValues('closingAmount') || 0)}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={close.isPending}>
            {c('cancel')}
          </Button>
          <Button className="bg-red-600 hover:bg-red-700" disabled={close.isPending} onClick={() => close.mutate(getValues())}>
            {close.isPending ? t('closing') : t('confirmClose')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

