'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';
import { REGISTER_KEYS, type CurrentRegister, type Option } from './register-types';

interface OpenResponse {
  id: number;
  locationId: number;
  openedAt: string;
  cashInHand: string;
}

/** Opening cash: blank counts as zero (Laravel only stores a row when it is not zero), otherwise a number of zero or more. */
const isAmount = (v: string) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);

/** "Open cash register" form: cash in hand and (when the user has several) the business location. */
export function OpenRegisterForm({ onOpened }: { onOpened?: (register: CurrentRegister) => void }) {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();

  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });

  const schema = z.object({
    amount: z.string().refine(isAmount, t('amountInvalid')),
    locationId: z.string(),
  });
  type Values = z.infer<typeof schema>;

  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { amount: '', locationId: '' } });
  const options = locations.data ?? [];

  const open = useMutation({
    mutationFn: (v: Values) =>
      api<OpenResponse>('/cash-registers', {
        method: 'POST',
        body: { amount: v.amount.trim() === '' ? '0' : v.amount.trim(), ...(v.locationId ? { locationId: Number(v.locationId) } : {}) },
      }),
    onSuccess: async (res) => {
      toast.success(t('registerOpened'));
      await qc.invalidateQueries({ queryKey: REGISTER_KEYS.current });
      await qc.invalidateQueries({ queryKey: REGISTER_KEYS.report });
      onOpened?.({ id: res.id, locationId: res.locationId, locationName: null, openedAt: res.openedAt, cashInHand: res.cashInHand });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      // Another tab may already have opened one: re-check.
      void qc.invalidateQueries({ queryKey: REGISTER_KEYS.current });
    },
  });

  const submit = (v: Values) => {
    if (options.length > 1 && !v.locationId) {
      setError('locationId', { message: t('selectLocation') });
      return;
    }
    open.mutate(v);
  };

  if (locations.isLoading) {
    return (
      <Card aria-busy="true">
        <div className="h-10 animate-pulse rounded bg-slate-100" />
      </Card>
    );
  }
  if (locations.isError) {
    return (
      <Card>
        <p role="alert" className="text-sm text-red-700">
          {c('loadError')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void locations.refetch()}>
          {c('retry')}
        </Button>
      </Card>
    );
  }
  if (options.length === 0) {
    return (
      <Card>
        <p role="alert" className="text-sm text-amber-700">
          {t('noLocationAccess')}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{t('openRegisterTitle')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('openRegisterHelp')}</p>
        </div>
        <Field label={t('cashInHand')} htmlFor="register-amount" error={formState.errors.amount?.message}>
          <Input id="register-amount" inputMode="decimal" autoFocus placeholder={t('cashInHandPlaceholder')} className="h-12 text-lg" {...register('amount')} />
        </Field>
        {options.length > 1 && (
          <Field label={t('location')} htmlFor="register-location" required error={formState.errors.locationId?.message}>
            <Select id="register-location" {...register('locationId')}>
              <option value="">{t('selectLocation')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={open.isPending}>
          {open.isPending ? t('opening') : t('openRegister')}
        </Button>
      </form>
    </Card>
  );
}
