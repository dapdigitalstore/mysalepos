'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError } from '@/lib/client-api';
import { allowedTypes, type Contact, type ContactSide, type ContactType, type Option } from './contact-types';

const num = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

function makeSchema(isDefault: boolean) {
  return z
    .object({
      type: z.enum(['supplier', 'customer', 'both']),
      kind: z.enum(['individual', 'business']),
      contactId: z.string().trim().max(191),
      customerGroupId: z.string(),
      supplierBusinessName: z.string().trim().max(191),
      prefix: z.string().trim().max(20),
      firstName: z.string().trim().max(191),
      middleName: z.string().trim().max(191),
      lastName: z.string().trim().max(191),
      mobile: z.string().trim().max(50),
      alternateNumber: z.string().trim().max(50),
      landline: z.string().trim().max(50),
      email: z.string().trim().max(191),
      dob: z.string(),
      taxNumber: z.string().trim().max(191),
      openingBalance: z.string(),
      payTermNumber: z.string(),
      payTermType: z.string(),
      creditLimit: z.string(),
      addressLine1: z.string().trim().max(191),
      addressLine2: z.string().trim().max(191),
      city: z.string().trim().max(191),
      state: z.string().trim().max(191),
      country: z.string().trim().max(191),
      zipCode: z.string().trim().max(20),
      landMark: z.string().trim().max(191),
      streetName: z.string().trim().max(191),
      buildingNumber: z.string().trim().max(191),
      additionalNumber: z.string().trim().max(191),
      shippingAddress: z.string().trim().max(1000),
    })
    .superRefine((v, ctx) => {
      const bad = (path: keyof FormValues, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (!isDefault) {
        if (!v.mobile) bad('mobile', 'required');
        if (v.kind === 'business' && !v.supplierBusinessName) bad('supplierBusinessName', 'required');
        if (v.kind === 'individual' && !v.firstName) bad('firstName', 'required');
      }
      if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad('email', 'invalidEmail');
      const hasNo = v.payTermNumber.trim() !== '';
      const hasType = v.payTermType !== '';
      if (hasNo !== hasType) bad(hasNo ? 'payTermType' : 'payTermNumber', 'payTermBoth');
      if (hasNo && (!num(v.payTermNumber) || !Number.isInteger(Number(v.payTermNumber)) || Number(v.payTermNumber) < 1)) bad('payTermNumber', 'payTermInvalid');
      if (v.creditLimit.trim() !== '' && (!num(v.creditLimit) || Number(v.creditLimit) < 0)) bad('creditLimit', 'amountInvalid');
      if (v.openingBalance.trim() !== '' && (!num(v.openingBalance) || Number(v.openingBalance) < 0)) bad('openingBalance', 'amountInvalid');
    });
}

type FormValues = {
  type: ContactType;
  kind: 'individual' | 'business';
  contactId: string;
  customerGroupId: string;
  supplierBusinessName: string;
  prefix: string;
  firstName: string;
  middleName: string;
  lastName: string;
  mobile: string;
  alternateNumber: string;
  landline: string;
  email: string;
  dob: string;
  taxNumber: string;
  openingBalance: string;
  payTermNumber: string;
  payTermType: string;
  creditLimit: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  landMark: string;
  streetName: string;
  buildingNumber: string;
  additionalNumber: string;
  shippingAddress: string;
};

const blank = (type: ContactType): FormValues => ({
  type,
  kind: 'individual',
  contactId: '',
  customerGroupId: '',
  supplierBusinessName: '',
  prefix: '',
  firstName: '',
  middleName: '',
  lastName: '',
  mobile: '',
  alternateNumber: '',
  landline: '',
  email: '',
  dob: '',
  taxNumber: '',
  openingBalance: '',
  payTermNumber: '',
  payTermType: '',
  creditLimit: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: '',
  zipCode: '',
  landMark: '',
  streetName: '',
  buildingNumber: '',
  additionalNumber: '',
  shippingAddress: '',
});

function fromContact(c: Contact): FormValues {
  const s = (v: string | null | undefined) => v ?? '';
  const ob = Number(c.opening_balance_due ?? 0);
  return {
    type: c.type,
    kind: c.contact_type === 'business' ? 'business' : 'individual',
    contactId: s(c.contact_id),
    customerGroupId: c.customer_group_id ? String(c.customer_group_id) : '',
    supplierBusinessName: s(c.supplier_business_name),
    prefix: s(c.prefix),
    firstName: s(c.first_name),
    middleName: s(c.middle_name),
    lastName: s(c.last_name),
    mobile: s(c.mobile),
    alternateNumber: s(c.alternate_number),
    landline: s(c.landline),
    email: s(c.email),
    dob: c.dob ? c.dob.slice(0, 10) : '',
    taxNumber: s(c.tax_number),
    openingBalance: ob ? String(ob) : '',
    payTermNumber: c.pay_term_number ? String(c.pay_term_number) : '',
    payTermType: s(c.pay_term_type),
    creditLimit: c.credit_limit != null ? String(Number(c.credit_limit)) : '',
    addressLine1: s(c.address_line_1),
    addressLine2: s(c.address_line_2),
    city: s(c.city),
    state: s(c.state),
    country: s(c.country),
    zipCode: s(c.zip_code),
    landMark: s(c.land_mark),
    streetName: s(c.street_name),
    buildingNumber: s(c.building_number),
    additionalNumber: s(c.additional_number),
    shippingAddress: s(c.shipping_address),
  };
}

/** Does the contact have anything stored in the collapsible "more information" part? */
function hasMoreInfo(c: Contact): boolean {
  return !!(
    c.tax_number || c.pay_term_number || c.credit_limit || c.dob || Number(c.opening_balance_due ?? 0) ||
    c.address_line_1 || c.address_line_2 || c.city || c.state || c.country || c.zip_code ||
    c.land_mark || c.street_name || c.building_number || c.additional_number || c.shipping_address
  );
}

const nul = (s: string): string | null => (s.trim() === '' ? null : s.trim());

interface Props {
  /** A contact to edit, 'new' to add, null when closed. */
  contact: Contact | 'new' | null;
  /** Type pre-selected when adding (the tab the user is on). */
  defaultSide: ContactSide;
  onClose: () => void;
}

export function ContactDialog({ contact, defaultSide, onClose }: Props) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = contact === 'new';
  const existing = contact && contact !== 'new' ? contact : null;
  const isDefault = existing?.is_default ?? false;
  const [more, setMore] = useState(false);

  const schema = useMemo(() => makeSchema(isDefault), [isDefault]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank(defaultSide) });
  const { register, handleSubmit, watch, reset, formState } = form;

  useEffect(() => {
    if (!contact) return;
    reset(existing ? fromContact(existing) : blank(defaultSide));
    setMore(existing ? hasMoreInfo(existing) : false);
  }, [contact, existing, defaultSide, reset]);

  const type = watch('type');
  const kind = watch('kind');
  const showCustomerFields = type !== 'supplier';
  const types = allowedTypes(can, isNew ? 'create' : 'update');
  // Keep the stored type selectable even if the user would not be able to pick it fresh.
  const typeChoices: ContactType[] = existing && !types.includes(existing.type) ? [existing.type, ...types] : types;

  const groups = useQuery({
    queryKey: ['customer-groups', 'options'],
    queryFn: () => api<Option[]>('/customer-groups/options'),
    enabled: !!contact && showCustomerFields,
  });

  // Live duplicate warnings: a repeated mobile is only a hint (like Laravel); a repeated contact id is an error.
  const mobile = useDebounced(watch('mobile').trim());
  const mobileCheck = useQuery({
    queryKey: ['contacts', 'check-mobile', mobile, existing?.id],
    queryFn: () => api<{ exists: boolean; contacts: { name: string | null }[] }>('/contacts/check-mobile', { query: { mobile, excludeId: existing?.id } }),
    enabled: !!contact && mobile.length >= 7,
  });
  const contactIdValue = useDebounced(watch('contactId').trim());
  const idCheck = useQuery({
    queryKey: ['contacts', 'check-contact-id', contactIdValue, existing?.id],
    queryFn: () => api<{ available: boolean }>('/contacts/check-contact-id', { query: { contactId: contactIdValue, excludeId: existing?.id } }),
    enabled: !!contact && contactIdValue.length > 0 && contactIdValue !== (existing?.contact_id ?? ''),
  });
  const idTaken = idCheck.data?.available === false;

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const customerSide = v.type !== 'supplier';
      const openingBalance = v.openingBalance.trim() === '' ? 0 : Number(v.openingBalance);
      const business = v.kind === 'business';
      const body = {
        type: v.type,
        contactType: v.kind,
        ...(v.contactId.trim() ? { contactId: v.contactId.trim() } : {}),
        // A business contact has no personal name and an individual has no business name.
        supplierBusinessName: business ? nul(v.supplierBusinessName) : null,
        prefix: business ? null : nul(v.prefix),
        firstName: business ? null : nul(v.firstName),
        middleName: business ? null : nul(v.middleName),
        lastName: business ? null : nul(v.lastName),
        mobile: v.mobile.trim(),
        alternateNumber: nul(v.alternateNumber),
        landline: nul(v.landline),
        email: nul(v.email),
        dob: business ? null : nul(v.dob),
        taxNumber: nul(v.taxNumber),
        payTermNumber: v.payTermNumber.trim() === '' ? null : Number(v.payTermNumber),
        payTermType: v.payTermType === '' ? null : v.payTermType,
        creditLimit: customerSide && v.creditLimit.trim() !== '' ? Number(v.creditLimit) : null,
        customerGroupId: customerSide && v.customerGroupId ? Number(v.customerGroupId) : null,
        // Adding: only send an opening balance when one is typed. Editing: send it so it can be corrected or cleared.
        ...(isNew ? (openingBalance > 0 ? { openingBalance } : {}) : { openingBalance }),
        addressLine1: nul(v.addressLine1),
        addressLine2: nul(v.addressLine2),
        city: nul(v.city),
        state: nul(v.state),
        country: nul(v.country),
        zipCode: nul(v.zipCode),
        landMark: nul(v.landMark),
        streetName: nul(v.streetName),
        buildingNumber: nul(v.buildingNumber),
        additionalNumber: nul(v.additionalNumber),
        shippingAddress: nul(v.shippingAddress),
      };
      return isNew ? api('/contacts', { method: 'POST', body }) : api(`/contacts/${existing?.id}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['contact'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const err = (k: keyof FormValues): string | undefined => {
    const m = formState.errors[k]?.message;
    if (!m) return undefined;
    return m === 'required' ? c('required') : t(m as 'invalidEmail');
  };
  const duplicateNames = mobileCheck.data?.exists ? mobileCheck.data.contacts.map((x) => x.name).filter(Boolean).join(', ') : '';

  return (
    <Dialog open={!!contact} onClose={onClose} title={isNew ? t('addTitle') : t('editTitle')} className="max-w-3xl">
      <form onSubmit={handleSubmit((v) => !idTaken && save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('type')} htmlFor="type" required>
            <Select id="type" {...register('type')} disabled={isDefault}>
              {typeChoices.map((x) => (
                <option key={x} value={x}>
                  {t(x === 'supplier' ? 'typeSupplier' : x === 'customer' ? 'typeCustomer' : 'typeBoth')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('contactIdLabel')} htmlFor="contactId" hint={t('contactIdHint')} error={idTaken ? t('contactIdTaken') : err('contactId')}>
            <Input id="contactId" {...register('contactId')} />
          </Field>
          {showCustomerFields && (
            <Field label={t('customerGroup')} htmlFor="customerGroupId">
              <Select id="customerGroupId" {...register('customerGroupId')}>
                <option value="">{t('noGroup')}</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <fieldset className="flex flex-wrap gap-5">
          <legend className="sr-only">{t('kindLegend')}</legend>
          {(['individual', 'business'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="radio" value={k} className="h-4 w-4 border-slate-300 text-primary focus:ring-primary" {...register('kind')} />
              {t(k === 'individual' ? 'kindIndividual' : 'kindBusiness')}
            </label>
          ))}
        </fieldset>

        {kind === 'business' && (
          <Field label={t('businessName')} htmlFor="supplierBusinessName" error={err('supplierBusinessName')} required>
            <Input id="supplierBusinessName" {...register('supplierBusinessName')} autoFocus />
          </Field>
        )}
        {kind === 'individual' && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t('prefix')} htmlFor="prefix" error={err('prefix')}>
              <Input id="prefix" placeholder={t('prefixPlaceholder')} {...register('prefix')} />
            </Field>
            <Field label={t('firstName')} htmlFor="firstName" error={err('firstName')} required={!isDefault}>
              <Input id="firstName" {...register('firstName')} autoFocus />
            </Field>
            <Field label={t('middleName')} htmlFor="middleName" error={err('middleName')}>
              <Input id="middleName" {...register('middleName')} />
            </Field>
            <Field label={t('lastName')} htmlFor="lastName" error={err('lastName')}>
              <Input id="lastName" {...register('lastName')} />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('mobile')} htmlFor="mobile" error={err('mobile')} required={!isDefault}>
            <Input id="mobile" type="tel" inputMode="tel" {...register('mobile')} />
            {duplicateNames && (
              <p className="mt-1 flex items-start gap-1 text-xs text-amber-700" role="status">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('mobileUsed', { names: duplicateNames })}
              </p>
            )}
          </Field>
          <Field label={t('alternateNumber')} htmlFor="alternateNumber" error={err('alternateNumber')}>
            <Input id="alternateNumber" type="tel" inputMode="tel" {...register('alternateNumber')} />
          </Field>
          <Field label={t('landline')} htmlFor="landline" error={err('landline')}>
            <Input id="landline" type="tel" inputMode="tel" {...register('landline')} />
          </Field>
          <Field label={t('email')} htmlFor="email" error={err('email')}>
            <Input id="email" type="email" inputMode="email" {...register('email')} />
          </Field>
          {kind === 'individual' && (
            <Field label={t('dob')} htmlFor="dob" error={err('dob')}>
              <Input id="dob" type="date" {...register('dob')} />
            </Field>
          )}
        </div>

        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="contact-more">
            {more ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {more ? t('lessInfo') : t('moreInfo')}
          </Button>
        </div>

        {more && (
          <div id="contact-more" className="space-y-4 rounded-lg border border-slate-200 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('taxNumber')} htmlFor="taxNumber" error={err('taxNumber')}>
                <Input id="taxNumber" {...register('taxNumber')} />
              </Field>
              <Field label={t('openingBalance')} htmlFor="openingBalance" error={err('openingBalance')} hint={t('openingBalanceHint')}>
                <Input id="openingBalance" type="number" step="0.01" min="0" inputMode="decimal" {...register('openingBalance')} />
              </Field>
              {showCustomerFields && (
                <Field label={t('creditLimit')} htmlFor="creditLimit" error={err('creditLimit')} hint={t('creditLimitHint')}>
                  <Input id="creditLimit" type="number" step="0.01" min="0" inputMode="decimal" {...register('creditLimit')} />
                </Field>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('payTermNumber')} htmlFor="payTermNumber" error={err('payTermNumber')} hint={t('payTermHint')}>
                <Input id="payTermNumber" type="number" step="1" min="1" inputMode="numeric" {...register('payTermNumber')} />
              </Field>
              <Field label={t('payTermType')} htmlFor="payTermType" error={err('payTermType')}>
                <Select id="payTermType" {...register('payTermType')}>
                  <option value="">{t('choose')}</option>
                  <option value="days">{t('days')}</option>
                  <option value="months">{t('months')}</option>
                </Select>
              </Field>
            </div>

            <h3 className="pt-1 text-sm font-semibold text-slate-800">{t('addressSection')}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('addressLine1')} htmlFor="addressLine1" error={err('addressLine1')}>
                <Input id="addressLine1" {...register('addressLine1')} />
              </Field>
              <Field label={t('addressLine2')} htmlFor="addressLine2" error={err('addressLine2')}>
                <Input id="addressLine2" {...register('addressLine2')} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={t('city')} htmlFor="city" error={err('city')}>
                <Input id="city" {...register('city')} />
              </Field>
              <Field label={t('state')} htmlFor="state" error={err('state')}>
                <Input id="state" {...register('state')} />
              </Field>
              <Field label={t('country')} htmlFor="country" error={err('country')}>
                <Input id="country" {...register('country')} />
              </Field>
              <Field label={t('zipCode')} htmlFor="zipCode" error={err('zipCode')}>
                <Input id="zipCode" {...register('zipCode')} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={t('landMark')} htmlFor="landMark" error={err('landMark')}>
                <Input id="landMark" {...register('landMark')} />
              </Field>
              <Field label={t('streetName')} htmlFor="streetName" error={err('streetName')}>
                <Input id="streetName" {...register('streetName')} />
              </Field>
              <Field label={t('buildingNumber')} htmlFor="buildingNumber" error={err('buildingNumber')}>
                <Input id="buildingNumber" {...register('buildingNumber')} />
              </Field>
              <Field label={t('additionalNumber')} htmlFor="additionalNumber" error={err('additionalNumber')}>
                <Input id="additionalNumber" {...register('additionalNumber')} />
              </Field>
            </div>
            <Field label={t('shippingAddress')} htmlFor="shippingAddress" error={err('shippingAddress')}>
              <Textarea id="shippingAddress" {...register('shippingAddress')} />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {c('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending || idTaken}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
