'use client';

import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { PriceField, PriceFields, TaxType } from './_lib/pricing';

/** The five linked price inputs of a single or combo product. Editing one recalculates the others (see _lib/pricing.ts). */
export function PriceInputs({
  value,
  onChange,
  taxType,
  purchaseReadOnly,
  idPrefix = 'price',
}: {
  value: PriceFields;
  onChange: (field: PriceField, raw: string) => void;
  taxType: TaxType;
  /** Combo products take their purchase price from the components. */
  purchaseReadOnly?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations('products');
  const input = (field: PriceField, readOnly = false) => (
    <Input
      id={`${idPrefix}-${field}`}
      type="number"
      step="any"
      min="0"
      inputMode="decimal"
      value={value[field]}
      readOnly={readOnly}
      onChange={(e) => onChange(field, e.target.value)}
      className={readOnly ? 'bg-slate-50' : undefined}
    />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Field label={t('price.purchaseExc')} htmlFor={`${idPrefix}-purchaseExc`}>
        {input('purchaseExc', purchaseReadOnly)}
      </Field>
      <Field label={t('price.purchaseInc')} htmlFor={`${idPrefix}-purchaseInc`}>
        {input('purchaseInc', purchaseReadOnly)}
      </Field>
      <Field label={t('price.profit')} htmlFor={`${idPrefix}-profit`}>
        {input('profit')}
      </Field>
      <Field label={t('price.sellExc')} htmlFor={`${idPrefix}-sellExc`} hint={taxType === 'exclusive' ? t('price.masterHint') : undefined}>
        {input('sellExc')}
      </Field>
      <Field label={t('price.sellInc')} htmlFor={`${idPrefix}-sellInc`} hint={taxType === 'inclusive' ? t('price.masterHint') : undefined}>
        {input('sellInc')}
      </Field>
    </div>
  );
}
