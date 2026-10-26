'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { formatMoney } from '@/lib/utils';
import { trimNumber } from './_lib/pricing';
import type { OpeningStockData } from './_lib/types';

interface Row {
  key: string;
  purchaseLineId?: number;
  variationId: string;
  quantity: string;
  price: string;
  date: string;
  dateOriginal: string;
  note: string;
  lot: string;
  exp: string;
  used: string;
}

let seq = 0;
const key = () => `r${(seq += 1)}`;
const today = () => new Date().toISOString().slice(0, 10);

const blankRow = (variationId: string): Row => ({ key: key(), variationId, quantity: '', price: '', date: today(), dateOriginal: '', note: '', lot: '', exp: '', used: '0' });

/** Opening stock per location and variation. Existing rows show the quantity still remaining; the API keeps the used part. */
export function OpeningStockEditor({ productId }: { productId: number }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [rows, setRows] = useState<Record<number, Row[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['products', 'opening-stock', productId], queryFn: () => api<OpeningStockData>(`/products/${productId}/opening-stock`), staleTime: 0 });

  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const next: Record<number, Row[]> = {};
    for (const l of d.locations) {
      const existing = d.rows
        .filter((r) => r.location_id === l.id)
        .map<Row>((r) => ({
          key: key(),
          purchaseLineId: r.purchase_line_id,
          variationId: String(r.variation_id),
          quantity: trimNumber(r.quantity),
          price: trimNumber(r.purchase_price),
          date: r.transaction_date.slice(0, 10),
          dateOriginal: r.transaction_date.slice(0, 10),
          note: r.note ?? '',
          lot: r.lot_number ?? '',
          exp: r.exp_date ? r.exp_date.slice(0, 10) : '',
          used: trimNumber(r.used) || '0',
        }));
      next[l.id] = existing.length > 0 ? existing : d.variations.length === 1 ? [blankRow(String(d.variations[0].id))] : [];
    }
    setRows(next);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const stocks = (q.data?.locations ?? []).map((l) => ({
        locationId: l.id,
        rows: (rows[l.id] ?? [])
          .filter((r) => r.purchaseLineId || Number(r.quantity) > 0)
          .map((r) => ({
            ...(r.purchaseLineId ? { purchaseLineId: r.purchaseLineId } : {}),
            variationId: Number(r.variationId),
            quantity: r.quantity === '' ? '0' : r.quantity,
            purchasePrice: r.price === '' ? '0' : r.price,
            ...(r.date && r.date !== r.dateOriginal ? { transactionDate: r.date } : {}),
            note: r.note.trim() || null,
            expDate: r.exp || null,
            lotNumber: r.lot.trim() || null,
          })),
      }));
      return api(`/products/${productId}/opening-stock`, { method: 'PUT', body: { stocks } });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      router.push(`/m/products/${productId}`);
    },
    onError: (e) => setFormError(e instanceof ApiError && e.messages.length ? e.messages.join(' ') : c('somethingWrong')),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl" aria-busy="true" aria-label={c('loading')}>
        <Card>
          <div className="h-5 w-48 animate-pulse rounded bg-slate-100" />
          <div className="mt-4 h-28 animate-pulse rounded bg-slate-100" />
        </Card>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{q.error instanceof ApiError && q.error.messages[0] ? q.error.messages[0] : c('loadError')}</span>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }

  const d = q.data;
  const taxRate = Number(d.product.tax_rate);
  const patch = (loc: number, k: string, fn: (r: Row) => Row) => setRows((cur) => ({ ...cur, [loc]: (cur[loc] ?? []).map((r) => (r.key === k ? fn(r) : r)) }));
  const remove = (loc: number, k: string) => setRows((cur) => ({ ...cur, [loc]: (cur[loc] ?? []).filter((r) => r.key !== k) }));
  const add = (loc: number) => setRows((cur) => ({ ...cur, [loc]: [...(cur[loc] ?? []), blankRow(String(d.variations[0]?.id ?? ''))] }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={t('opening.title', { name: d.product.name })} description={t('opening.subtitle')} />

      {d.locations.length === 0 && (
        <Card role="status" className="text-sm text-slate-600">
          {t('opening.noLocations')}
        </Card>
      )}

      {d.locations.map((l) => {
        const list = rows[l.id] ?? [];
        return (
          <Card key={l.id} className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">{l.name}</h2>
            {list.length === 0 ? (
              <p className="text-sm text-slate-500">{t('opening.noRows')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-start text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      {d.variations.length > 1 && <th scope="col" className="px-2 py-2 text-start">{t('opening.variation')}</th>}
                      <th scope="col" className="px-2 py-2 text-start">{t('opening.quantity')} {d.product.unit_name ? `(${d.product.unit_name})` : ''}</th>
                      <th scope="col" className="px-2 py-2 text-start">{t('opening.unitPrice')}</th>
                      <th scope="col" className="px-2 py-2 text-start">{t('opening.date')}</th>
                      {d.settings.enableLot && <th scope="col" className="px-2 py-2 text-start">{t('opening.lot')}</th>}
                      {d.settings.enableExpiry && <th scope="col" className="px-2 py-2 text-start">{t('opening.expiry')}</th>}
                      <th scope="col" className="px-2 py-2 text-start">{t('opening.note')}</th>
                      <th scope="col" className="px-2 py-2 text-end">{t('opening.total')}</th>
                      <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{c('actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const total = Number(r.quantity || 0) * Number(r.price || 0) * (1 + taxRate / 100);
                      const used = Number(r.used);
                      return (
                        <tr key={r.key} className="border-t border-slate-100 align-top">
                          {d.variations.length > 1 && (
                            <td className="px-2 py-1.5">
                              <Select
                                value={r.variationId}
                                onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, variationId: e.target.value }))}
                                disabled={!!r.purchaseLineId}
                                aria-label={`${t('opening.variation')} ${l.name}`}
                                className="h-9 min-w-[10rem]"
                              >
                                {d.variations.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                              </Select>
                            </td>
                          )}
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              step={d.product.allow_decimal ? 'any' : '1'}
                              min="0"
                              inputMode="decimal"
                              value={r.quantity}
                              onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, quantity: e.target.value }))}
                              aria-label={`${t('opening.quantity')} ${l.name}`}
                              className="h-9 w-28"
                            />
                            {used > 0 && <p className="mt-1 text-xs text-slate-500">{t('opening.used', { qty: used })}</p>}
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              inputMode="decimal"
                              value={r.price}
                              onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, price: e.target.value }))}
                              aria-label={`${t('opening.unitPrice')} ${l.name}`}
                              className="h-9 w-28"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input type="date" value={r.date} onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, date: e.target.value }))} aria-label={`${t('opening.date')} ${l.name}`} className="h-9 w-40" />
                          </td>
                          {d.settings.enableLot && (
                            <td className="px-2 py-1.5">
                              <Input value={r.lot} onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, lot: e.target.value }))} aria-label={`${t('opening.lot')} ${l.name}`} className="h-9 w-28" />
                            </td>
                          )}
                          {d.settings.enableExpiry && (
                            <td className="px-2 py-1.5">
                              <Input type="date" value={r.exp} onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, exp: e.target.value }))} aria-label={`${t('opening.expiry')} ${l.name}`} className="h-9 w-40" />
                            </td>
                          )}
                          <td className="px-2 py-1.5">
                            <Input value={r.note} onChange={(e) => patch(l.id, r.key, (cur) => ({ ...cur, note: e.target.value }))} aria-label={`${t('opening.note')} ${l.name}`} className="h-9 min-w-[8rem]" />
                          </td>
                          <td className="whitespace-nowrap px-2 py-3 text-end">{formatMoney(total)}</td>
                          <td className="px-2 py-1.5">
                            {used === 0 && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => remove(l.id, r.key)} aria-label={`${c('delete')} ${l.name}`}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => add(l.id)}>
              <Plus className="h-4 w-4" />
              {t('opening.addRow')}
            </Button>
          </Card>
        );
      })}

      {formError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-card backdrop-blur">
        <Link href={`/m/products/${productId}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {c('cancel')}
        </Link>
        <Button type="button" disabled={save.isPending || d.locations.length === 0} onClick={() => { setFormError(null); save.mutate(); }}>
          {save.isPending ? c('saving') : c('save')}
        </Button>
      </div>
    </div>
  );
}
