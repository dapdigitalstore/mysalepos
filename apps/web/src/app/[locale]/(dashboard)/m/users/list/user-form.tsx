'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox, Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { blankPersonal, PersonalInfoFields, personalFromApi, personalShape, personalToBody, type PersonalApi } from '../personal-info';

interface Option {
  id: number;
  label: string;
}

interface RoleOption extends Option {
  isAdmin: boolean;
}

interface UserDetail extends PersonalApi {
  id: number;
  surname: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  status: 'active' | 'inactive' | 'terminated';
  allowLogin: boolean;
  hasPassword: boolean;
  roleId: number | null;
  roleName: string | null;
  cmmsnPercent: string;
  maxSalesDiscountPercent: string | null;
  isEnableServiceStaffPin: boolean;
  hasServiceStaffPin: boolean;
  accessAllLocations: boolean;
  locationIds: number[];
  selectedContacts: boolean;
  contacts: Option[];
}

const num = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

function makeSchema(isNew: boolean, hasPassword: boolean, hasPin: boolean) {
  return z
    .object({
      surname: z.string().trim().max(10),
      firstName: z.string().trim().min(1, 'vRequired').max(191),
      lastName: z.string().trim().max(191),
      email: z.string().trim().min(1, 'vRequired').max(191),
      status: z.enum(['active', 'inactive', 'terminated']),
      allowLogin: z.boolean(),
      username: z.string().trim().max(191),
      password: z.string().max(100),
      confirmPassword: z.string().max(100),
      roleId: z.string().min(1, 'vRequired'),
      accessAllLocations: z.boolean(),
      locationIds: z.array(z.string()),
      cmmsnPercent: z.string().trim(),
      maxSalesDiscountPercent: z.string().trim(),
      isEnableServiceStaffPin: z.boolean(),
      serviceStaffPin: z.string().trim().max(20),
      selectedContacts: z.boolean(),
      ...personalShape,
    })
    .superRefine((v, ctx) => {
      const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (!/^\S+@\S+\.\S+$/.test(v.email)) bad('email', 'vEmail');
      if (v.allowLogin) {
        if (v.username && v.username.length < 5) bad('username', 'vUsernameMin');
        else if (/\s/.test(v.username)) bad('username', 'vUsernameSpaces');
        if (!v.password && (isNew || !hasPassword)) bad('password', 'vPasswordRequired');
        else if (v.password && v.password.length < 5) bad('password', 'vPasswordMin');
        if (v.password && v.confirmPassword !== v.password) bad('confirmPassword', 'vPasswordMismatch');
      }
      if (v.cmmsnPercent && !(num(v.cmmsnPercent) && Number(v.cmmsnPercent) >= 0 && Number(v.cmmsnPercent) <= 99.99)) bad('cmmsnPercent', 'vPercent');
      if (v.maxSalesDiscountPercent && !(num(v.maxSalesDiscountPercent) && Number(v.maxSalesDiscountPercent) >= 0 && Number(v.maxSalesDiscountPercent) <= 100)) {
        bad('maxSalesDiscountPercent', 'vDiscount');
      }
      if (v.isEnableServiceStaffPin && !v.serviceStaffPin && !hasPin) bad('serviceStaffPin', 'vPinRequired');
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

export function UserForm({ userId }: { userId?: number }) {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const router = useRouter();
  const isNew = userId === undefined;

  const roles = useQuery({ queryKey: ['roles', 'options'], queryFn: () => api<RoleOption[]>('/roles/options') });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });
  const meta = useQuery({ queryKey: ['users', 'form-meta'], queryFn: () => api<{ usernameSuffix: string }>('/users/form-meta') });
  const detail = useQuery({
    queryKey: ['users', 'detail', userId],
    queryFn: () => api<UserDetail>(`/users/${userId}`),
    enabled: !isNew,
    // always show what is stored right now when the page is opened
    gcTime: 0,
  });

  const queries = [roles, locations, meta, ...(isNew ? [] : [detail])];
  const failed = queries.some((q) => q.isError);
  const ready = roles.data && locations.data && meta.data && (isNew || detail.data);

  return (
    <div>
      <PageHeader
        title={isNew ? t('add') : t('edit')}
        actions={
          <Button variant="outline" onClick={() => router.push('/m/users/list')}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('backToList')}
          </Button>
        }
      />
      {failed && (
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{t('formLoadError')}</span>
          <Button variant="outline" size="sm" onClick={() => queries.forEach((q) => void q.refetch())}>
            {c('retry')}
          </Button>
        </Card>
      )}
      {!failed && !ready && (
        <Card className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </Card>
      )}
      {!failed && ready && (
        <UserFormInner
          userId={userId}
          roles={roles.data ?? []}
          locations={locations.data ?? []}
          usernameSuffix={meta.data?.usernameSuffix ?? ''}
          existing={detail.data ?? null}
        />
      )}
    </div>
  );
}

function initialValues(d: UserDetail | null): FormValues {
  if (!d) {
    return {
      surname: '', firstName: '', lastName: '', email: '', status: 'active', allowLogin: true, username: '', password: '', confirmPassword: '',
      roleId: '', accessAllLocations: true, locationIds: [], cmmsnPercent: '', maxSalesDiscountPercent: '', isEnableServiceStaffPin: false,
      serviceStaffPin: '', selectedContacts: false, ...blankPersonal(),
    };
  }
  return {
    surname: d.surname,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email,
    status: d.status,
    allowLogin: d.allowLogin,
    username: d.username ?? '',
    password: '',
    confirmPassword: '',
    roleId: d.roleId ? String(d.roleId) : '',
    accessAllLocations: d.accessAllLocations,
    locationIds: d.locationIds.map(String),
    cmmsnPercent: Number(d.cmmsnPercent) === 0 ? '' : String(Number(d.cmmsnPercent)),
    maxSalesDiscountPercent: d.maxSalesDiscountPercent === null ? '' : String(Number(d.maxSalesDiscountPercent)),
    isEnableServiceStaffPin: d.isEnableServiceStaffPin,
    serviceStaffPin: '',
    selectedContacts: d.selectedContacts,
    ...personalFromApi(d),
  };
}

function UserFormInner({
  userId,
  roles,
  locations,
  usernameSuffix,
  existing,
}: {
  userId?: number;
  roles: RoleOption[];
  locations: Option[];
  usernameSuffix: string;
  existing: UserDetail | null;
}) {
  const t = useTranslations('users');
  const c = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = userId === undefined;

  const form = useForm<FormValues>({
    resolver: zodResolver(makeSchema(isNew, existing?.hasPassword ?? false, existing?.hasServiceStaffPin ?? false)),
    defaultValues: initialValues(existing),
  });
  const { register, handleSubmit, watch, setValue, formState } = form;
  const allowLogin = watch('allowLogin');
  const accessAll = watch('accessAllLocations');
  const locationIds = watch('locationIds');
  const pinEnabled = watch('isEnableServiceStaffPin');
  const selectedContacts = watch('selectedContacts');
  const username = watch('username');
  const [contacts, setContacts] = useState<Option[]>(existing?.contacts ?? []);

  const roleLabel = (name: string) => (name === 'Admin' ? t('roleAdmin') : name === 'Cashier' ? t('roleCashier') : name);
  // an admin user keeps showing its role even when the dropdown hides the Admin role from non-admins
  const roleChoices: Option[] = roles.map((r) => ({ id: r.id, label: roleLabel(r.label) }));
  if (existing?.roleId && !roleChoices.some((r) => r.id === existing.roleId)) {
    roleChoices.push({ id: existing.roleId, label: roleLabel(existing.roleName ?? '') });
  }

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const { confirmPassword: _confirm, roleId, locationIds: ids, cmmsnPercent, maxSalesDiscountPercent, ...rest } = v;
      const personal = personalToBody(rest);
      const body = {
        surname: v.surname,
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        status: v.status,
        roleId: Number(roleId),
        allowLogin: v.allowLogin,
        ...(v.allowLogin ? { username: v.username || undefined, password: v.password || undefined } : {}),
        cmmsnPercent: cmmsnPercent === '' ? 0 : Number(cmmsnPercent),
        maxSalesDiscountPercent: maxSalesDiscountPercent === '' ? null : Number(maxSalesDiscountPercent),
        isEnableServiceStaffPin: v.isEnableServiceStaffPin,
        serviceStaffPin: v.isEnableServiceStaffPin ? v.serviceStaffPin || undefined : undefined,
        accessAllLocations: v.accessAllLocations,
        locationIds: v.accessAllLocations ? [] : ids.map(Number),
        selectedContacts: v.selectedContacts,
        selectedContactIds: v.selectedContacts ? contacts.map((x) => x.id) : [],
        ...personal,
      };
      return isNew ? api('/users', { method: 'POST', body }) : api(`/users/${userId}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['users'] });
      router.push('/m/users/list');
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof FormValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (!m) return formState.errors[k] ? t('vRequired') : undefined;
    return /^v[A-Z]/.test(m) ? t(m) : t('vRequired');
  };

  const toggleLocation = (id: string) =>
    setValue('locationIds', locationIds.includes(id) ? locationIds.filter((x) => x !== id) : [...locationIds, id], { shouldDirty: true });

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">{t('sectionBasic')}</h2>
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label={t('surname')} htmlFor="surname" error={err('surname')} className="sm:col-span-1">
              <Input id="surname" placeholder={t('surnamePlaceholder')} {...register('surname')} />
            </Field>
            <Field label={t('firstName')} htmlFor="firstName" error={err('firstName')} required className="sm:col-span-3">
              <Input id="firstName" {...register('firstName')} autoFocus />
            </Field>
            <Field label={t('lastName')} htmlFor="lastName" error={err('lastName')} className="sm:col-span-2">
              <Input id="lastName" {...register('lastName')} />
            </Field>
            <Field label={t('email')} htmlFor="email" error={err('email')} required className="sm:col-span-4">
              <Input id="email" type="email" autoComplete="off" {...register('email')} />
            </Field>
            <Field label={t('status')} htmlFor="status" hint={t('statusHint')} className="sm:col-span-2">
              <Select id="status" {...register('status')}>
                <option value="active">{t('statusActive')}</option>
                <option value="inactive">{t('statusInactive')}</option>
                <option value="terminated">{t('statusTerminated')}</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">{t('sectionAccess')}</h2>
          <div className="space-y-4">
            <Checkbox id="allowLogin" label={t('allowLogin')} {...register('allowLogin')} />
            {allowLogin && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label={t('username')}
                  htmlFor="username"
                  error={err('username')}
                  hint={username && usernameSuffix && !username.endsWith(usernameSuffix) ? t('usernamePreview', { value: `${username}${usernameSuffix}` }) : t('usernameHint')}
                >
                  <div className="flex items-center gap-2">
                    <Input id="username" autoComplete="off" {...register('username')} />
                    {usernameSuffix && <span className="shrink-0 text-sm text-slate-500">{usernameSuffix}</span>}
                  </div>
                </Field>
                <Field
                  label={t('password')}
                  htmlFor="password"
                  error={err('password')}
                  hint={isNew || !existing?.hasPassword ? undefined : t('passwordHintEdit')}
                  required={isNew || !existing?.hasPassword}
                >
                  <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
                </Field>
                <Field label={t('confirmPassword')} htmlFor="confirmPassword" error={err('confirmPassword')}>
                  <Input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} />
                </Field>
              </div>
            )}
            <Field label={t('role')} htmlFor="roleId" error={err('roleId')} required className="max-w-md">
              <Select id="roleId" {...register('roleId')}>
                <option value="">{t('chooseRole')}</option>
                {roleChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">{t('accessLocations')}</legend>
              <div className="space-y-2">
                <Checkbox id="accessAllLocations" label={t('allLocations')} {...register('accessAllLocations')} />
                {locations.length === 0 && <p className="text-sm text-slate-500">{t('noLocations')}</p>}
                <div className="grid gap-2 ps-6 sm:grid-cols-2 lg:grid-cols-3">
                  {locations.map((l) => (
                    <label key={l.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50"
                        checked={accessAll || locationIds.includes(String(l.id))}
                        disabled={accessAll}
                        onChange={() => toggleLocation(String(l.id))}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">{t('sectionSales')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('cmmsnPercent')} htmlFor="cmmsnPercent" error={err('cmmsnPercent')} hint={t('cmmsnHint')}>
              <Input id="cmmsnPercent" inputMode="decimal" {...register('cmmsnPercent')} />
            </Field>
            <Field label={t('maxDiscount')} htmlFor="maxSalesDiscountPercent" error={err('maxSalesDiscountPercent')} hint={t('maxDiscountHint')}>
              <Input id="maxSalesDiscountPercent" inputMode="decimal" {...register('maxSalesDiscountPercent')} />
            </Field>
          </div>
          <div className="mt-4 space-y-4">
            <Checkbox id="isEnableServiceStaffPin" label={t('enableServiceStaffPin')} {...register('isEnableServiceStaffPin')} />
            {pinEnabled && (
              <Field
                label={t('serviceStaffPin')}
                htmlFor="serviceStaffPin"
                error={err('serviceStaffPin')}
                hint={existing?.hasServiceStaffPin ? t('pinHintEdit') : undefined}
                className="max-w-xs"
              >
                <Input id="serviceStaffPin" type="password" autoComplete="new-password" {...register('serviceStaffPin')} />
              </Field>
            )}
            <Checkbox id="selectedContacts" label={t('selectedContacts')} {...register('selectedContacts')} />
            {selectedContacts && <ContactPicker selected={contacts} onChange={setContacts} />}
          </div>
        </Card>

        <Card>
          <details open={!isNew}>
            <summary className="cursor-pointer text-base font-semibold text-slate-900">{t('sectionMore')}</summary>
            <div className="mt-4">
              <PersonalInfoFields />
            </div>
          </details>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/m/users/list')} disabled={save.isPending}>
            {c('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function ContactPicker({ selected, onChange }: { selected: Option[]; onChange: (next: Option[]) => void }) {
  const t = useTranslations('users');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const results = useQuery({
    queryKey: ['users', 'contacts-lookup', debounced],
    queryFn: () => api<Option[]>('/users/contacts-lookup', { query: { q: debounced } }),
    enabled: debounced.length > 0,
  });
  const picked = new Set(selected.map((s) => s.id));
  const available = (results.data ?? []).filter((r) => !picked.has(r.id));

  return (
    <div className="max-w-xl space-y-2">
      <Field label={t('contactSearch')} htmlFor="contactSearch">
        <Input id="contactSearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('contactSearchPlaceholder')} autoComplete="off" />
      </Field>
      {debounced.length > 0 && !results.isLoading && available.length === 0 && <p className="text-sm text-slate-500">{t('noContactsFound')}</p>}
      {available.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm">
          {available.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start hover:bg-slate-50"
                onClick={() => {
                  onChange([...selected, r]);
                  setSearch('');
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-full bg-primary-light px-3 py-1 text-xs text-primary-dark">
              {s.label}
              <button type="button" onClick={() => onChange(selected.filter((x) => x.id !== s.id))} aria-label={t('removeContact', { name: s.label })}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
