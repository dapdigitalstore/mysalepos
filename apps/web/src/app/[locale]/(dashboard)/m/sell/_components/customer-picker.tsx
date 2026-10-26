'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type RefObject } from 'react';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { cn, formatMoney } from '@/lib/utils';
import { dec, isPos } from '../_lib/decimal';
import { saleApi } from '../_lib/sale-api';
import type { CustomerOption } from '../_lib/sale-types';
import { NewCustomerDialog } from './new-customer-dialog';
import { SALE_KEYS } from './use-sale-settings';

interface Props {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption) => void;
  inputRef?: RefObject<HTMLInputElement>;
  /** Dom id of the input (for a <label htmlFor>). */
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** Customer search box (name / mobile / contact id) with a quick "new customer" button. The walk-in customer is the default. */
export function CustomerPicker({ value, onChange, inputRef, id, disabled, className }: Props) {
  const t = useTranslations('pos');
  const can = useCan();
  const listId = useId();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(term.trim(), 250);

  const options = useQuery({
    queryKey: [...SALE_KEYS.customers, debounced],
    queryFn: () => saleApi<CustomerOption[]>('/contacts/options', { query: { type: 'customer', search: debounced, limit: 20 } }),
    enabled: open,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const list = options.data ?? [];
  useEffect(() => setActive(0), [debounced]);

  const choose = (c: CustomerOption) => {
    onChange(c);
    setTerm('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(list.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && list[active]) choose(list[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setTerm('');
    }
  };

  const balance = value?.balance && isPos(dec(value.balance)) ? value.balance : null;

  return (
    <div className={cn('relative', className)}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            ref={inputRef}
            value={open ? term : (value?.label ?? '')}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={(e) => {
              setOpen(true);
              e.currentTarget.select();
            }}
            onBlur={() =>
              setTimeout(() => {
                setOpen(false);
                setTerm('');
              }, 150)
            }
            onKeyDown={onKeyDown}
            placeholder={value?.label ?? t('customerSearch')}
            aria-label={t('customer')}
            aria-controls={listId}
            aria-expanded={open}
            role="combobox"
            autoComplete="off"
            disabled={disabled}
            className="pe-9"
          />
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        </div>
        {can('customer.create') && (
          <Button type="button" variant="outline" className="h-11 w-11 shrink-0 px-0" onClick={() => setCreating(true)} aria-label={t('newCustomer.title')} title={t('newCustomer.title')} disabled={disabled}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {open && (
        <ul id={listId} role="listbox" aria-label={t('customer')} className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.isError ? (
            <li role="alert" className="p-3 text-sm text-red-700">
              {t('customerError')}
            </li>
          ) : options.isLoading ? (
            <li className="p-3 text-sm text-slate-500">{t('searching')}</li>
          ) : list.length === 0 ? (
            <li className="p-3 text-sm text-slate-500">{t('noCustomers')}</li>
          ) : (
            list.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm', i === active ? 'bg-primary-light/60' : 'hover:bg-slate-50')}
                >
                  <span className="min-w-0 truncate font-medium text-slate-900">{c.label}</span>
                  <span className="shrink-0 text-xs text-slate-500">{c.mobile}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {value && !value.isDefault && (value.mobile || balance) && (
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {value.mobile && <span>{value.mobile}</span>}
          {balance && (
            <span className="font-medium text-emerald-700">
              {t('advanceBalance')}: {formatMoney(balance)}
            </span>
          )}
        </p>
      )}

      <NewCustomerDialog open={creating} onClose={() => setCreating(false)} onCreated={choose} />
    </div>
  );
}
