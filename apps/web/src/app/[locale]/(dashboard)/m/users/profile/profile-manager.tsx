'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/client-api';
import { blankPersonal, PersonalInfoFields, personalFromApi, personalShape, personalToBody, type PersonalApi } from '../personal-info';

interface Me extends PersonalApi {
  id: number;
  surname: string;
  firstName: string;
  lastName: string;
  email: string;
  language: string;
  roleName: string | null;
}

const profileSchema = z
  .object({
    surname: z.string().trim().max(10),
    firstName: z.string().trim().min(1, 'vRequired').max(191),
    lastName: z.string().trim().max(191),
    email: z.string().trim().min(1, 'vRequired').max(191),
    language: z.string().max(7),
    ...personalShape,
  })
  .superRefine((v, ctx) => {
    if (!/^\S+@\S+\.\S+$/.test(v.email)) ctx.addIssue({ code: 'custom', path: ['email'], message: 'vEmail' });
  });
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'vRequired'),
    newPassword: z.string().min(5, 'vPasswordMin').max(100),
    confirmNewPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.confirmNewPassword !== v.newPassword) ctx.addIssue({ code: 'custom', path: ['confirmNewPassword'], message: 'vPasswordMismatch' });
  });
type PasswordValues = z.infer<typeof passwordSchema>;

export function ProfileManager() {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const me = useQuery({ queryKey: ['users', 'me'], queryFn: () => api<Me>('/users/me'), gcTime: 0 });

  return (
    <div>
      <PageHeader title={t('profileTitle')} description={t('profileSubtitle')} />
      {me.isError && (
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{c('loadError')}</span>
          <Button variant="outline" size="sm" onClick={() => void me.refetch()}>
            {c('retry')}
          </Button>
        </Card>
      )}
      {me.isLoading && (
        <Card className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </Card>
      )}
      {me.data && (
        <div className="space-y-5">
          <ProfileForm me={me.data} />
          <PasswordForm />
        </div>
      )}
    </div>
  );
}

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError && e.messages[0] ? e.messages[0] : fallback;
}

function ProfileForm({ me }: { me: Me }) {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      surname: me.surname,
      firstName: me.firstName,
      lastName: me.lastName,
      email: me.email,
      language: me.language,
      ...blankPersonal(),
      ...personalFromApi(me),
    },
  });
  const { register, handleSubmit, formState } = form;

  const save = useMutation({
    mutationFn: (v: ProfileValues) => {
      const { surname, firstName, lastName, email, language, ...rest } = v;
      return api('/users/me', { method: 'PUT', body: { surname, firstName, lastName, email, language, ...personalToBody(rest) } });
    },
    onSuccess: () => {
      toast.success(t('profileSaved'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorText(e, c('somethingWrong'))),
  });

  const err = (k: keyof ProfileValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (!m) return formState.errors[k] ? t('vRequired') : undefined;
    return /^v[A-Z]/.test(m) ? t(m) : t('vRequired');
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">{t('sectionBasic')}</h2>
            {me.roleName && (
              <span className="text-sm text-slate-500">
                {t('profileRole', { role: me.roleName === 'Admin' ? t('roleAdmin') : me.roleName === 'Cashier' ? t('roleCashier') : me.roleName })}
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label={t('surname')} htmlFor="surname" error={err('surname')} className="sm:col-span-1">
              <Input id="surname" placeholder={t('surnamePlaceholder')} {...register('surname')} />
            </Field>
            <Field label={t('firstName')} htmlFor="firstName" error={err('firstName')} required className="sm:col-span-3">
              <Input id="firstName" {...register('firstName')} />
            </Field>
            <Field label={t('lastName')} htmlFor="lastName" error={err('lastName')} className="sm:col-span-2">
              <Input id="lastName" {...register('lastName')} />
            </Field>
            <Field label={t('email')} htmlFor="email" error={err('email')} required className="sm:col-span-4">
              <Input id="email" type="email" {...register('email')} />
            </Field>
            <Field label={t('language')} htmlFor="language" className="sm:col-span-2">
              <Select id="language" {...register('language')}>
                <option value="en">{t('langEn')}</option>
                <option value="si">{t('langSi')}</option>
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">{t('sectionMore')}</h2>
          <PersonalInfoFields />
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : t('saveProfile')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function PasswordForm() {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const toast = useToast();

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmNewPassword: '' },
  });
  const { register, handleSubmit, reset, formState } = form;

  const save = useMutation({
    mutationFn: (v: PasswordValues) => api('/users/me/password', { method: 'PUT', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }),
    onSuccess: () => {
      toast.success(t('passwordUpdated'));
      reset();
    },
    onError: (e) => toast.error(errorText(e, c('somethingWrong'))),
  });

  useEffect(() => () => reset(), [reset]);

  const err = (k: keyof PasswordValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (!m) return formState.errors[k] ? t('vRequired') : undefined;
    return /^v[A-Z]/.test(m) ? t(m) : t('vRequired');
  };

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-slate-900">{t('changePassword')}</h2>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('currentPassword')} htmlFor="currentPassword" error={err('currentPassword')} required>
            <Input id="currentPassword" type="password" autoComplete="current-password" {...register('currentPassword')} />
          </Field>
          <Field label={t('newPassword')} htmlFor="newPassword" error={err('newPassword')} required>
            <Input id="newPassword" type="password" autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <Field label={t('confirmNewPassword')} htmlFor="confirmNewPassword" error={err('confirmNewPassword')} required>
            <Input id="confirmNewPassword" type="password" autoComplete="new-password" {...register('confirmNewPassword')} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : t('updatePassword')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
