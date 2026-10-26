'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { emptyPrices, recalc, type PriceField, type PriceFields } from './_lib/pricing';
import type { TemplateOption } from './_lib/types';

export interface VarRow {
  key: string;
  /** Existing variation id (edit). */
  id?: number;
  name: string;
  subSku: string;
  valueId?: number;
  prices: PriceFields;
}

export interface VarGroup {
  key: string;
  /** Existing product_variations id (edit). */
  id?: number;
  templateId: string;
  name: string;
  rows: VarRow[];
}

let counter = 0;
export const newKey = () => `k${Date.now().toString(36)}${(counter += 1)}`;

export const newRow = (name: string, profit: string, valueId?: number): VarRow => ({ key: newKey(), name, subSku: '', valueId, prices: emptyPrices(profit) });
export const newGroup = (): VarGroup => ({ key: newKey(), templateId: '', name: '', rows: [] });

/** Editor of the variation groups (Size, Colour ...) and their values with prices, for variable products. */
export function VariationEditor({
  groups,
  onChange,
  templates,
  taxPercent,
  defaultProfit,
}: {
  groups: VarGroup[];
  onChange: (groups: VarGroup[]) => void;
  templates: TemplateOption[];
  taxPercent: number;
  defaultProfit: string;
}) {
  const t = useTranslations('products');
  const c = useTranslations('common');

  const patchGroup = (key: string, fn: (g: VarGroup) => VarGroup) => onChange(groups.map((g) => (g.key === key ? fn(g) : g)));
  const patchRow = (gKey: string, rKey: string, fn: (r: VarRow) => VarRow) => patchGroup(gKey, (g) => ({ ...g, rows: g.rows.map((r) => (r.key === rKey ? fn(r) : r)) }));

  const setPrice = (gKey: string, rKey: string, field: PriceField, raw: string) =>
    patchRow(gKey, rKey, (r) => ({ ...r, prices: recalc({ ...r.prices, [field]: raw }, field, taxPercent) }));

  const chooseTemplate = (g: VarGroup, id: string) => {
    const tpl = templates.find((x) => String(x.id) === id);
    patchGroup(g.key, (cur) => ({ ...cur, templateId: id, name: tpl ? tpl.label : cur.name }));
  };

  const addTemplateValue = (g: VarGroup, v: { id: number; label: string }) => {
    if (g.rows.some((r) => r.valueId === v.id || r.name.toLowerCase() === v.label.toLowerCase())) return;
    patchGroup(g.key, (cur) => ({ ...cur, rows: [...cur.rows, newRow(v.label, defaultProfit, v.id)] }));
  };

  const copyFirst = (g: VarGroup) => {
    const first = g.rows[0];
    if (!first) return;
    patchGroup(g.key, (cur) => ({ ...cur, rows: cur.rows.map((r, i) => (i === 0 ? r : { ...r, prices: { ...first.prices } })) }));
  };

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => {
        const tpl = templates.find((x) => String(x.id) === g.templateId);
        const locked = g.id !== undefined; // an existing group keeps its template
        return (
          <Card key={g.key} className="space-y-3 border border-slate-200 shadow-none">
            <div className="flex flex-wrap items-end gap-3">
              {!locked && (
                <div className="space-y-1">
                  <label htmlFor={`tpl-${g.key}`} className="block text-sm font-medium text-slate-700">
                    {t('variations.template')}
                  </label>
                  <Select id={`tpl-${g.key}`} value={g.templateId} onChange={(e) => chooseTemplate(g, e.target.value)} className="w-56">
                    <option value="">{t('variations.customTemplate')}</option>
                    {templates.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor={`gname-${g.key}`} className="block text-sm font-medium text-slate-700">
                  {t('variations.groupName')}
                  <span className="ms-0.5 text-red-600" aria-hidden="true">
                    *
                  </span>
                </label>
                <Input id={`gname-${g.key}`} value={g.name} onChange={(e) => patchGroup(g.key, (cur) => ({ ...cur, name: e.target.value }))} className="w-56" />
              </div>
              <div className="ms-auto flex gap-2">
                {g.rows.length > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => copyFirst(g)}>
                    {t('variations.copyFirst')}
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(groups.filter((x) => x.key !== g.key))} aria-label={`${t('variations.removeGroup')} ${gi + 1}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>

            {tpl && tpl.values.length > 0 && !locked && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('variations.templateValues')}>
                <span className="text-xs text-slate-500">{t('variations.templateValues')}</span>
                {tpl.values.map((v) => {
                  const used = g.rows.some((r) => r.valueId === v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => addTemplateValue(g, v)}
                      disabled={used}
                      className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-start text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-start">{t('variations.value')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('variations.subSku')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('price.purchaseExc')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('price.purchaseInc')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('price.profit')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('price.sellExc')}</th>
                    <th scope="col" className="px-2 py-2 text-start">{t('price.sellInc')}</th>
                    <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{c('actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, ri) => {
                    const cell = (field: PriceField) => (
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        value={r.prices[field]}
                        onChange={(e) => setPrice(g.key, r.key, field, e.target.value)}
                        aria-label={`${t(`price.${field}`)} ${r.name || ri + 1}`}
                        className="h-9 min-w-[6rem]"
                      />
                    );
                    return (
                      <tr key={r.key} className="border-t border-slate-100">
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.name}
                            onChange={(e) => patchRow(g.key, r.key, (cur) => ({ ...cur, name: e.target.value }))}
                            aria-label={`${t('variations.value')} ${ri + 1}`}
                            className="h-9 min-w-[8rem]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={r.subSku}
                            onChange={(e) => patchRow(g.key, r.key, (cur) => ({ ...cur, subSku: e.target.value }))}
                            placeholder={t('variations.skuAuto')}
                            aria-label={`${t('variations.subSku')} ${r.name || ri + 1}`}
                            className="h-9 min-w-[8rem]"
                          />
                        </td>
                        <td className="px-2 py-1.5">{cell('purchaseExc')}</td>
                        <td className="px-2 py-1.5">{cell('purchaseInc')}</td>
                        <td className="px-2 py-1.5">{cell('profit')}</td>
                        <td className="px-2 py-1.5">{cell('sellExc')}</td>
                        <td className="px-2 py-1.5">{cell('sellInc')}</td>
                        <td className="px-2 py-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => patchGroup(g.key, (cur) => ({ ...cur, rows: cur.rows.filter((x) => x.key !== r.key) }))}
                            aria-label={`${c('delete')} ${r.name || ri + 1}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {g.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-4 text-center text-sm text-slate-500">
                        {t('variations.noValues')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => patchGroup(g.key, (cur) => ({ ...cur, rows: [...cur.rows, newRow('', defaultProfit)] }))}>
              <Plus className="h-4 w-4" />
              {t('variations.addValue')}
            </Button>
          </Card>
        );
      })}
      <Button type="button" variant="outline" onClick={() => onChange([...groups, newGroup()])}>
        <Plus className="h-4 w-4" />
        {t('variations.addGroup')}
      </Button>
    </div>
  );
}
