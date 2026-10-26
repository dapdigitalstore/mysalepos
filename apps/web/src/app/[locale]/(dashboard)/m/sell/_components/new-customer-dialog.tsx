'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saleApi } from '../_lib/sale-api';
import type { CustomerOption } from '../_lib/sale-types';
import { SALE_KEYS } from './use-sale-settings';
import { useSaleError } from './use-sale-error';

const schema = z
  .object({
    kind: z.enum(['individual', 'business']),
    firstName: z.string().trim().max(191),
    lastName: z.string().trim().max(191),
    businessName: z.string().trim().max(191),
    mobile: z.string().trim().min(1, 'required').max(50),
    email: z.string().trim().max(191),
    address: z.string().trim().max(191),
    city: z.string().trim().max(191),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'individual' && !v.firstName) ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'required' });
    if (v.kind === 'business' && !v.businessName) ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'required' });
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'invalidEmail' });
  });

type FormValues = z.infer<typeof schema>;

const blank: FormValues = { kind: 'individual', firstName: '', lastName: '', businessName: '', mobile: '', email: '', address: '', city: '' };

/** The columns of the new contact row that the sale screen needs (the API returns the stored row as it is). */
interface CreatedContact {
  id: number;
  name: string | null;
  supplier_business_name: string | null;
  contact_id: string | null;
  mobile: string | null;
  customer_group_id: number | null;
  pay_term_number: number | null;
  pay_term_type: string | null;
  credit_limit: string | null;
}

function toOption(c: CreatedContact): CustomerOption {
  const name = c.name ?? c.supplier_business_name ?? '';
  const head = c.supplier_business_name && c.supplier_business_name !== name ? `${name} - ${c.supplier_business_name}` : name;
  return {
    id: c.id,
    label: c.contact_id ? `${head} (${c.contact_id})` : head,
    mobile: c.mobile,
    customerGroupId: c.customer_group_id,
    isDefault: false,
    payTermNumber: c.pay_term_number,
    payTermType: c.pay_term_type,
    balance: null,
    creditLimit: c.credit_limit,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: CustomerOption) => void;
}

/** Quick "new customer" for the sale screens: the few fields a cashier has to hand (POST /contacts, type customer). */
export function NewCustomerDialog({ open, onClose, onCreated }: Props) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const describe = useSaleError();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank });
  const kind = watch('kind');

  useEffect(() => {
    if (!open) return;
    reset(blank);
    // the native dialog focuses its close button first
    const id = setTimeout(() => document.getElementById('nc-first')?.focus(), 80);
    return () => clearTimeout(id);
  }, [open, reset]);

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      saleApi<CreatedContact>('/contacts', {
        method: 'POST',
        body: {
          type: 'customer',
          contactType: v.kind,
          firstName: v.kind === 'individual' ? v.firstName : undefined,
          lastName: v.kind === 'individual' ? v.lastName : undefined,
          supplierBusinessName: v.kind === 'business' ? v.businessName : undefined,
          mobile: v.mobile,
          email: v.email,
          addressLine1: v.address,
          city: v.city,
        },
      }),
    onSuccess: (row) => {
      toast.success(t('newCustomer.created'));
      void qc.invalidateQueries({ queryKey: SALE_KEYS.customers });
      onCreated(toOption(row));
      onClose();
    },
    onError: (e) => toast.error(describe(e)),
  });

  const err = (key: keyof FormValues): string | undefined => {
    const m = errors[key]?.message;
    if (!m) return undefined;
    return m === 'invalidEmail' ? t('newCustomer.invalidEmail') : c('required');
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('newCustomer.title')}>
      <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-3">
        <Field label={t('newCustomer.kind')} htmlFor="nc-kind">
          <Select id="nc-kind" {...register('kind')}>
            <option value="individual">{t('newCustomer.individual')}</option>
            <option value="business">{t('newCustomer.business')}</option>
          </Select>
        </Field>
        {kind === 'individual' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('newCustomer.firstName')} htmlFor="nc-first" required error={err('firstName')}>
              <Input id="nc-first" autoFocus autoComplete="off" {...register('firstName')} />
            </Field>
            <Field label={t('newCustomer.lastName')} htmlFor="nc-last" error={err('lastName')}>
              <Input id="nc-last" autoComplete="off" {...register('lastName')} />
            </Field>
          </div>
        ) : (
          <Field label={t('newCustomer.businessName')} htmlFor="nc-business" required error={err('businessName')}>
            <Input id="nc-business" autoFocus autoComplete="off" {...register('businessName')} />
          </Field>
        )}
        <Field label={t('newCustomer.mobile')} htmlFor="nc-mobile" required error={err('mobile')}>
          <Input id="nc-mobile" type="tel" inputMode="tel" autoComplete="off" {...register('mobile')} />
        </Field>
        <Field label={t('newCustomer.email')} htmlFor="nc-email" error={err('email')}>
          <Input id="nc-email" type="email" autoComplete="off" {...register('email')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('newCustomer.address')} htmlFor="nc-address">
            <Input id="nc-address" autoComplete="off" {...register('address')} />
          </Field>
          <Field label={t('newCustomer.city')} htmlFor="nc-city">
            <Input id="nc-city" autoComplete="off" {...register('city')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            {c('cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
