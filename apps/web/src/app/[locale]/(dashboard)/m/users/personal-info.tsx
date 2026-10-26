'use client';

import { useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const t0 = z.string().trim();

/** Zod fields of the "more information" block (shared by the user form and the profile page). */
export const personalShape = {
  dob: z.string(),
  gender: z.string(),
  maritalStatus: z.string(),
  bloodGroup: t0.max(10),
  contactNumber: t0.max(20),
  altNumber: t0.max(191),
  familyNumber: t0.max(191),
  fbLink: t0.max(191),
  twitterLink: t0.max(191),
  socialMedia1: t0.max(191),
  socialMedia2: t0.max(191),
  customField1: t0.max(191),
  customField2: t0.max(191),
  customField3: t0.max(191),
  customField4: t0.max(191),
  guardianName: t0.max(191),
  idProofName: t0.max(191),
  idProofNumber: t0.max(191),
  permanentAddress: t0.max(2000),
  currentAddress: t0.max(2000),
  accountHolderName: t0.max(191),
  accountNumber: t0.max(191),
  bankName: t0.max(191),
  bankCode: t0.max(191),
  branch: t0.max(191),
  taxPayerId: t0.max(191),
};

export type PersonalValues = { [K in keyof typeof personalShape]: string };

/** Shape of what GET /users/:id and GET /users/me return for this block. */
export interface PersonalApi {
  dob: string | null;
  gender: string;
  maritalStatus: string;
  bloodGroup: string;
  contactNumber: string;
  altNumber: string;
  familyNumber: string;
  fbLink: string;
  twitterLink: string;
  socialMedia1: string;
  socialMedia2: string;
  customField1: string;
  customField2: string;
  customField3: string;
  customField4: string;
  guardianName: string;
  idProofName: string;
  idProofNumber: string;
  permanentAddress: string;
  currentAddress: string;
  bankDetails: { accountHolderName: string; accountNumber: string; bankName: string; bankCode: string; branch: string; taxPayerId: string };
}

export function blankPersonal(): PersonalValues {
  return {
    dob: '', gender: '', maritalStatus: '', bloodGroup: '', contactNumber: '', altNumber: '', familyNumber: '', fbLink: '', twitterLink: '',
    socialMedia1: '', socialMedia2: '', customField1: '', customField2: '', customField3: '', customField4: '', guardianName: '',
    idProofName: '', idProofNumber: '', permanentAddress: '', currentAddress: '',
    accountHolderName: '', accountNumber: '', bankName: '', bankCode: '', branch: '', taxPayerId: '',
  };
}

export function personalFromApi(d: PersonalApi): PersonalValues {
  const { bankDetails: b, dob, ...rest } = d;
  return { ...blankPersonal(), ...rest, dob: dob ?? '', ...b };
}

/** Request body part for the block ('' clears a field on the API). */
export function personalToBody(v: PersonalValues) {
  const { accountHolderName, accountNumber, bankName, bankCode, branch, taxPayerId, ...rest } = v;
  return { ...rest, bankDetails: { accountHolderName, accountNumber, bankName, bankCode, branch, taxPayerId } };
}

/** Must be rendered inside a react-hook-form <FormProvider> whose values include PersonalValues. */
export function PersonalInfoFields() {
  const t = useTranslations('users');
  const { register, formState } = useFormContext<PersonalValues>();
  const today = new Date().toISOString().slice(0, 10);
  const text = (name: keyof PersonalValues, label: string, extra?: { type?: string }) => (
    <Field label={label} htmlFor={name} error={formState.errors[name] ? t('vRequired') : undefined}>
      <Input id={name} type={extra?.type} {...register(name)} />
    </Field>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('dob')} htmlFor="dob">
          <Input id="dob" type="date" max={today} {...register('dob')} />
        </Field>
        <Field label={t('gender')} htmlFor="gender">
          <Select id="gender" {...register('gender')}>
            <option value="">{t('notSet')}</option>
            <option value="male">{t('genderMale')}</option>
            <option value="female">{t('genderFemale')}</option>
            <option value="others">{t('genderOthers')}</option>
          </Select>
        </Field>
        <Field label={t('maritalStatus')} htmlFor="maritalStatus">
          <Select id="maritalStatus" {...register('maritalStatus')}>
            <option value="">{t('notSet')}</option>
            <option value="married">{t('maritalMarried')}</option>
            <option value="unmarried">{t('maritalUnmarried')}</option>
            <option value="divorced">{t('maritalDivorced')}</option>
          </Select>
        </Field>
        {text('bloodGroup', t('bloodGroup'))}
        {text('contactNumber', t('contactNumber'))}
        {text('altNumber', t('altNumber'))}
        {text('familyNumber', t('familyNumber'))}
        {text('fbLink', t('fbLink'))}
        {text('twitterLink', t('twitterLink'))}
        {text('socialMedia1', t('socialMedia', { number: 1 }))}
        {text('socialMedia2', t('socialMedia', { number: 2 }))}
        {text('customField1', t('customField', { number: 1 }))}
        {text('customField2', t('customField', { number: 2 }))}
        {text('customField3', t('customField', { number: 3 }))}
        {text('customField4', t('customField', { number: 4 }))}
        {text('guardianName', t('guardianName'))}
        {text('idProofName', t('idProofName'))}
        {text('idProofNumber', t('idProofNumber'))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('permanentAddress')} htmlFor="permanentAddress">
          <Textarea id="permanentAddress" rows={3} {...register('permanentAddress')} />
        </Field>
        <Field label={t('currentAddress')} htmlFor="currentAddress">
          <Textarea id="currentAddress" rows={3} {...register('currentAddress')} />
        </Field>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">{t('bankDetails')}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text('accountHolderName', t('accountHolderName'))}
          {text('accountNumber', t('accountNumber'))}
          {text('bankName', t('bankName'))}
          {text('bankCode', t('bankCode'))}
          {text('branch', t('branch'))}
          {text('taxPayerId', t('taxPayerId'))}
        </div>
      </div>
    </div>
  );
}
