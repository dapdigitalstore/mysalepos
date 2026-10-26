'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database, Pencil, Power, PowerOff, Tag, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import type { ProductDetail } from './_lib/types';

const STOCK_STYLE = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  low_stock: 'bg-amber-50 text-amber-700',
  out_of_stock: 'bg-red-50 text-red-700',
  not_tracked: 'bg-slate-100 text-slate-500',
} as const;

export function ProductDetailView({ productId }: { productId: number }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);

  const q = useQuery({ queryKey: ['products', 'detail', productId], queryFn: () => api<ProductDetail>(`/products/${productId}`), staleTime: 0 });
  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['products'] });

  const remove = useMutation({
    mutationFn: () => api(`/products/${productId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      refresh();
      router.push('/m/products');
    },
    onError: (e) => {
      fail(e);
      setConfirmDelete(false);
    },
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api(`/products/${productId}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(c('saved'));
      refresh();
    },
    onError: fail,
  });
  const duplicate = useMutation({
    mutationFn: () => api<{ id: number }>(`/products/${productId}/duplicate`, { method: 'POST' }),
    onSuccess: (p) => {
      toast.success(t('duplicated'));
      refresh();
      router.push(`/m/products/${p.id}/edit`);
    },
    onError: fail,
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label={c('loading')}>
        {[0, 1].map((i) => (
          <Card key={i}>
            <div className="h-5 w-48 animate-pulse rounded bg-slate-100" />
            <div className="mt-4 h-28 animate-pulse rounded bg-slate-100" />
          </Card>
        ))}
      </div>
    );
  }
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto max-w-5xl">
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{notFound ? t('notFound') : c('loadError')}</span>
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              {c('retry')}
            </Button>
          )}
        </Card>
      </div>
    );
  }

  const p = q.data;
  const unitName = p.unit?.short_name ?? '';
  const showPurchase = p.product_variations.some((g) => g.variations.some((v) => v.default_purchase_price !== null));
  const allVariations = p.product_variations.flatMap((g) => g.variations.map((v) => ({ ...v, group: g })));
  const locationStock = p.locations.map((l) => ({
    ...l,
    perVariation: allVariations.map((v) => ({ variation: v, qty: v.stock.find((s) => s.location_id === l.id)?.qty_available ?? '0' })),
  }));

  const info: [string, React.ReactNode][] = [
    [t('form.sku'), <span key="sku" className="font-mono">{p.sku}</span>],
    [t('form.type'), t(`types.${p.type}`)],
    [t('form.barcodeType'), p.barcode_type ?? '-'],
    [t('form.unit'), p.unit ? `${p.unit.actual_name} (${p.unit.short_name})` : '-'],
    [t('form.brand'), p.brand_name ?? '-'],
    [t('form.category'), [p.category_name, p.sub_category_name].filter(Boolean).join(' / ') || '-'],
    [t('form.tax'), p.tax_name ? `${p.tax_name} (${Number(p.tax_rate)}%)` : t('form.noTax')],
    [t('form.taxType'), t(`form.${p.tax_type}`)],
    [t('form.warranty'), p.warranty_name ?? '-'],
    [t('form.weight'), p.weight || '-'],
    [t('form.enableStock'), p.enable_stock ? c('yes') : c('no')],
    ...(p.enable_stock ? ([[t('form.alertQuantity'), p.alert_quantity !== null ? `${Number(p.alert_quantity)} ${unitName}` : '-']] as [string, React.ReactNode][]) : []),
    ...(p.expiry_period ? ([[t('form.expiryPeriod'), `${Number(p.expiry_period)} ${p.expiry_period_type ? t(`form.${p.expiry_period_type}`) : ''}`]] as [string, React.ReactNode][]) : []),
    [t('form.enableSrNo'), p.enable_sr_no ? c('yes') : c('no')],
    [t('form.locations'), p.locations.map((l) => l.name).join(', ') || '-'],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={p.name}
        description={t('detail.subtitle', { sku: p.sku })}
        actions={
          <>
            {can('product.update') && (
              <Link href={`/m/products/${p.id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-dark">
                <Pencil className="h-4 w-4" />
                {c('edit')}
              </Link>
            )}
            {p.enable_stock && can('product.opening_stock') && (
              <Link href={`/m/products/${p.id}/opening-stock`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Database className="h-4 w-4" />
                {t('openingStock')}
              </Link>
            )}
            {can('product.create', 'product.update') && p.price_groups.length > 0 && (
              <Button variant="outline" onClick={() => setPricesOpen(true)}>
                <Tag className="h-4 w-4" />
                {t('groupPrices.title')}
              </Button>
            )}
            {can('product.create') && (
              <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
                <Copy className="h-4 w-4" />
                {t('duplicate')}
              </Button>
            )}
            {can('product.update') && (
              <Button variant="outline" onClick={() => toggle.mutate(p.is_inactive)} disabled={toggle.isPending}>
                {p.is_inactive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                {p.is_inactive ? t('activate') : t('deactivate')}
              </Button>
            )}
            {can('product.delete') && (
              <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" />
                {c('delete')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.is_inactive && <span className="rounded-full bg-slate-200 px-2.5 py-1 font-medium text-slate-700">{t('inactive')}</span>}
        {p.not_for_selling && <span className="rounded-full bg-slate-200 px-2.5 py-1 font-medium text-slate-700">{t('notForSelling')}</span>}
        <span className={cn('rounded-full px-2.5 py-1 font-medium', STOCK_STYLE[p.stock_status])}>
          {p.enable_stock ? `${t('detail.inStock')}: ${Number(p.current_stock ?? 0)} ${unitName}` : t('stock.not_tracked')}
          {p.stock_status === 'low_stock' && ` - ${t('stock.low_stock')}`}
          {p.stock_status === 'out_of_stock' && ` - ${t('stock.out_of_stock')}`}
        </span>
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">{t('detail.overview')}</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
        {p.product_description && <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-700">{p.product_description}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <h2 className="px-5 pb-2 pt-5 text-base font-semibold text-slate-900">{t('detail.prices')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {p.type === 'variable' && <th scope="col" className="px-4 py-2 text-start">{t('variations.value')}</th>}
                <th scope="col" className="px-4 py-2 text-start">{t('variations.subSku')}</th>
                {showPurchase && (
                  <>
                    <th scope="col" className="px-4 py-2 text-end">{t('price.purchaseExc')}</th>
                    <th scope="col" className="px-4 py-2 text-end">{t('price.purchaseInc')}</th>
                    <th scope="col" className="px-4 py-2 text-end">{t('price.profit')}</th>
                  </>
                )}
                <th scope="col" className="px-4 py-2 text-end">{t('price.sellExc')}</th>
                <th scope="col" className="px-4 py-2 text-end">{t('price.sellInc')}</th>
                {p.enable_stock && <th scope="col" className="px-4 py-2 text-end">{t('columns.stock')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allVariations.map((v) => {
                const stock = v.stock.reduce((sum, s) => sum + Number(s.qty_available), 0);
                return (
                  <tr key={v.id}>
                    {p.type === 'variable' && (
                      <td className="px-4 py-2">
                        {v.name}
                        <div className="text-xs text-slate-500">{v.group.name}</div>
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-xs">{v.sub_sku}</td>
                    {showPurchase && (
                      <>
                        <td className="px-4 py-2 text-end">{formatMoney(v.default_purchase_price ?? 0)}</td>
                        <td className="px-4 py-2 text-end">{formatMoney(v.dpp_inc_tax ?? 0)}</td>
                        <td className="px-4 py-2 text-end">{Number(v.profit_percent ?? 0)}%</td>
                      </>
                    )}
                    <td className="px-4 py-2 text-end">{formatMoney(v.default_sell_price ?? 0)}</td>
                    <td className="px-4 py-2 text-end font-medium">{formatMoney(v.sell_price_inc_tax ?? 0)}</td>
                    {p.enable_stock && <td className="px-4 py-2 text-end">{stock} {unitName}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {p.type === 'combo' && (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 pb-2 pt-5 text-base font-semibold text-slate-900">{t('form.comboTitle')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-start text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start">{t('combo.product')}</th>
                  <th scope="col" className="px-4 py-2 text-end">{t('combo.quantity')}</th>
                  <th scope="col" className="px-4 py-2 text-start">{t('combo.unit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.combo_items.map((i) => (
                  <tr key={i.variation_id}>
                    <td className="px-4 py-2">
                      {i.product_name}
                      {i.variation_name ? ` - ${i.variation_name}` : ''}
                      <span className="ms-2 font-mono text-xs text-slate-500">{i.sub_sku}</span>
                    </td>
                    <td className="px-4 py-2 text-end">{Number(i.quantity)}</td>
                    <td className="px-4 py-2">{i.unit_name ?? unitName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {p.enable_stock && (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 pb-2 pt-5 text-base font-semibold text-slate-900">{t('detail.stockByLocation')}</h2>
          {locationStock.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-slate-500">{t('detail.noLocations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-start text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start">{t('filters.location')}</th>
                    {allVariations.map((v) => (
                      <th key={v.id} scope="col" className="px-4 py-2 text-end">
                        {p.type === 'variable' ? v.name : t('columns.stock')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {locationStock.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{l.name}</td>
                      {l.perVariation.map((pv) => (
                        <td key={pv.variation.id} className="px-4 py-2 text-end">
                          {Number(pv.qty)} {unitName}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {p.price_groups.length > 0 && allVariations.some((v) => v.group_prices.length > 0) && (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 pb-2 pt-5 text-base font-semibold text-slate-900">{t('groupPrices.title')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-start text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start">{t('variations.subSku')}</th>
                  {p.price_groups.map((g) => (
                    <th key={g.id} scope="col" className="px-4 py-2 text-end">{g.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allVariations.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-2">{p.type === 'variable' ? `${v.name} (${v.sub_sku})` : v.sub_sku}</td>
                    {p.price_groups.map((g) => {
                      const gp = v.group_prices.find((x) => x.price_group_id === g.id);
                      return (
                        <td key={g.id} className="px-4 py-2 text-end">
                          {gp ? formatMoney(gp.calculated_price) : '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} busy={remove.isPending} onConfirm={() => remove.mutate()} title={t('deleteTitle')} body={t('deleteBody')} />
      <GroupPricesDialog open={pricesOpen} onClose={() => setPricesOpen(false)} productId={productId} />
    </div>
  );
}

interface GroupPricesData {
  priceGroups: { id: number; name: string }[];
  variations: { id: number; label: string; sub_sku: string | null; sell_price_inc_tax: string | null; prices: { price_group_id: number; price_inc_tax: string; price_type: string }[] }[];
}

interface Cell {
  price: string;
  type: 'fixed' | 'percentage';
}

/** Selling price group prices per variation (Laravel "Add selling price group prices"). Empty = no special price. */
function GroupPricesDialog({ open, onClose, productId }: { open: boolean; onClose: () => void; productId: number }) {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const [cells, setCells] = useState<Record<string, Cell>>({});

  const q = useQuery({ queryKey: ['products', 'group-prices', productId], queryFn: () => api<GroupPricesData>(`/products/${productId}/group-prices`), enabled: open, staleTime: 0 });

  useEffect(() => {
    if (!q.data) return;
    const next: Record<string, Cell> = {};
    for (const v of q.data.variations) {
      for (const g of q.data.priceGroups) {
        const found = v.prices.find((p) => p.price_group_id === g.id);
        next[`${v.id}:${g.id}`] = { price: found ? String(Number(found.price_inc_tax)) : '', type: found?.price_type === 'percentage' ? 'percentage' : 'fixed' };
      }
    }
    setCells(next);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const prices = Object.entries(cells).map(([key, cell]) => {
        const [variationId, priceGroupId] = key.split(':').map(Number);
        return { variationId, priceGroupId, price: cell.price === '' ? null : cell.price, priceType: cell.type };
      });
      return api(`/products/${productId}/group-prices`, { method: 'PUT', body: { prices } });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const patch = (key: string, fn: (cur: Cell) => Cell) => setCells((cur) => ({ ...cur, [key]: fn(cur[key] ?? { price: '', type: 'fixed' }) }));

  return (
    <Dialog open={open} onClose={onClose} title={t('groupPrices.title')} className="max-w-3xl">
      {q.isLoading && <p className="text-sm text-slate-500">{c('loading')}</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{c('loadError')}</p>}
      {q.data && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t('groupPrices.hint')}</p>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-start text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-2 py-2 text-start">{t('variations.subSku')}</th>
                  {q.data.priceGroups.map((g) => (
                    <th key={g.id} scope="col" className="px-2 py-2 text-start">{g.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.variations.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      {v.label}
                      <div className="text-xs text-slate-500">{formatMoney(v.sell_price_inc_tax ?? 0)}</div>
                    </td>
                    {q.data.priceGroups.map((g) => {
                      const key = `${v.id}:${g.id}`;
                      const cell = cells[key] ?? { price: '', type: 'fixed' };
                      return (
                        <td key={g.id} className="px-2 py-2">
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              inputMode="decimal"
                              value={cell.price}
                              onChange={(e) => patch(key, (cur) => ({ ...cur, price: e.target.value }))}
                              aria-label={`${g.name} ${v.label}`}
                              className="h-9 w-24"
                            />
                            <Select value={cell.type} onChange={(e) => patch(key, (cur) => ({ ...cur, type: e.target.value === 'percentage' ? 'percentage' : 'fixed' }))} aria-label={`${t('groupPrices.type')} ${g.name}`} className="h-9 w-24 px-2">
                              <option value="fixed">{t('groupPrices.fixed')}</option>
                              <option value="percentage">%</option>
                            </Select>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {c('cancel')}
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? c('saving') : c('save')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
