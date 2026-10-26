'use client';

import { useTranslations } from 'next-intl';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { rangeDays, type RangeKey } from './format';

export interface RangeValue {
  range: RangeKey;
  startDate: string;
  endDate: string;
}

export const NO_RANGE: RangeValue = { range: 'all', startDate: '', endDate: '' };

const KEYS: RangeKey[] = ['all', 'today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'custom'];

/** Quick ranges (computed in the business time zone) plus a custom From/To pair. The API takes local days YYYY-MM-DD. */
export function DateRangeFilter({ value, timeZone, onChange, idPrefix = 'dr' }: { value: RangeValue; timeZone: string; onChange: (v: RangeValue) => void; idPrefix?: string }) {
  const t = useTranslations('sales');

  const pick = (range: RangeKey) => {
    if (range === 'custom') onChange({ range, startDate: value.startDate, endDate: value.endDate });
    else onChange({ range, ...rangeDays(range, timeZone) });
  };

  return (
    <>
      <Field label={t('filterDateRange')} htmlFor={`${idPrefix}-range`}>
        <Select id={`${idPrefix}-range`} value={value.range} onChange={(e) => pick(e.target.value as RangeKey)}>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`range_${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      {value.range === 'custom' && (
        <>
          <Field label={t('filterFrom')} htmlFor={`${idPrefix}-from`}>
            <Input id={`${idPrefix}-from`} type="date" value={value.startDate} max={value.endDate || undefined} onChange={(e) => onChange({ ...value, startDate: e.target.value })} />
          </Field>
          <Field label={t('filterTo')} htmlFor={`${idPrefix}-to`}>
            <Input id={`${idPrefix}-to`} type="date" value={value.endDate} min={value.startDate || undefined} onChange={(e) => onChange({ ...value, endDate: e.target.value })} />
          </Field>
        </>
      )}
    </>
  );
}
