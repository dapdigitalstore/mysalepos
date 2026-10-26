'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { api } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { comboTotal } from './_lib/pricing';
import type { SearchHit, SubUnit } from './_lib/types';

export interface ComboLine {
  variationId: number;
  label: string;
  quantity: string;
  unitId: number | null;
  units: SubUnit[];
  purchasePrice: string;
}

export const comboLinesTotal = (lines: ComboLine[]) =>
  comboTotal(
    lines.map((l) => ({
      quantity: l.quantity,
      multiplier: l.units.find((u) => u.id === l.unitId)?.multiplier ?? '1',
      purchasePrice: l.purchasePrice,
    })),
  );

/** Composition of a combo product: search products, set quantity and unit. The purchase price comes from these lines. */
export function ComboEditor({ lines, onChange }: { lines: ComboLine[]; onChange: (lines: ComboLine[]) => void }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term.trim());

  const hits = useQuery({
    queryKey: ['products', 'search', 'combo', debounced],
    queryFn: () => api<SearchHit[]>('/products/search', { query: { term: debounced, productTypes: 'single,variable', limit: 10 } }),
    enabled: debounced.length >= 1,
  });

  const add = async (h: SearchHit) => {
    if (lines.some((l) => l.variationId === h.variation_id)) return;
    let units: SubUnit[] = [];
    if (h.unit_id) {
      try {
        units = await api<SubUnit[]>('/products/sub-units', { query: { unitId: h.unit_id } });
      } catch {
        units = [];
      }
    }
    onChange([...lines, { variationId: h.variation_id, label: h.label, quantity: '1', unitId: h.unit_id, units, purchasePrice: h.purchase_price ?? '0' }]);
    setTerm('');
  };

  const patch = (id: number, fn: (l: ComboLine) => ComboLine) => onChange(lines.map((l) => (l.variationId === id ? fn(l) : l)));

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('combo.search')} className="ps-9" aria-label={t('combo.search')} />
        {debounced && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox" aria-label={t('combo.results')}>
            {hits.isLoading && <li className="px-3 py-2 text-sm text-slate-500">{c('loading')}</li>}
            {hits.isError && <li className="px-3 py-2 text-sm text-red-700">{c('loadError')}</li>}
            {hits.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{c('noResults')}</li>}
            {hits.data?.map((h) => (
              <li key={h.variation_id} role="option" aria-selected={false}>
                <button type="button" onClick={() => void add(h)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-primary-light">
                  <span>{h.label}</span>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatMoney(h.selling_price)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{t('combo.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-start text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-2 py-2 text-start">{t('combo.product')}</th>
                <th scope="col" className="px-2 py-2 text-start">{t('combo.quantity')}</th>
                <th scope="col" className="px-2 py-2 text-start">{t('combo.unit')}</th>
                <th scope="col" className="px-2 py-2 text-end">{t('combo.lineTotal')}</th>
                <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{c('actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const unit = l.units.find((u) => u.id === l.unitId);
                const line = comboTotal([{ quantity: l.quantity, multiplier: unit?.multiplier ?? '1', purchasePrice: l.purchasePrice }]);
                return (
                  <tr key={l.variationId} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{l.label}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => patch(l.variationId, (cur) => ({ ...cur, quantity: e.target.value }))}
                        aria-label={`${t('combo.quantity')} ${l.label}`}
                        className="h-9 w-28"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {l.units.length > 1 ? (
                        <Select
                          value={l.unitId ?? ''}
                          onChange={(e) => patch(l.variationId, (cur) => ({ ...cur, unitId: Number(e.target.value) }))}
                          aria-label={`${t('combo.unit')} ${l.label}`}
                          className="h-9 w-36"
                        >
                          {l.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span>{l.units[0]?.label ?? '-'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-end">{formatMoney(line)}</td>
                    <td className="px-2 py-1.5">
                      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(lines.filter((x) => x.variationId !== l.variationId))} aria-label={`${c('delete')} ${l.label}`}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
