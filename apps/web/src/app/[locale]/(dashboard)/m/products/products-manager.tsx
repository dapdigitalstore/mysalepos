'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database, Eye, Pencil, Plus, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError, type Paginated } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import type { Option, ProductRow, StockStatus } from './_lib/types';

interface Filters {
  type: string;
  categoryId: string;
  subCategoryId: string;
  brandId: string;
  unitId: string;
  taxId: string;
  locationId: string;
  activeState: string;
  stockStatus: string;
}

const NO_FILTERS: Filters = { type: '', categoryId: '', subCategoryId: '', brandId: '', unitId: '', taxId: '', locationId: '', activeState: '', stockStatus: '' };

const STOCK_STYLE: Record<StockStatus, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  low_stock: 'bg-amber-50 text-amber-700',
  out_of_stock: 'bg-red-50 text-red-700',
  not_tracked: 'bg-slate-100 text-slate-500',
};

type BulkAction = 'delete' | 'deactivate' | 'activate';

export function ProductsManager() {
  const t = useTranslations('products');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ sortBy: 'name', sortDir: 'asc' });
  const [selected, setSelected] = useState<number[]>([]);
  const [deleting, setDeleting] = useState<ProductRow | 'selected' | null>(null);
  const debounced = useDebounced(search);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [debounced, filters]);

  const list = useQuery({
    queryKey: ['products', { page, search: debounced, ...filters, ...sort }],
    queryFn: () => api<Paginated<ProductRow>>('/products', { query: { page, search: debounced, ...filters, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const units = useQuery({ queryKey: ['units', 'options'], queryFn: () => api<Option[]>('/units/options') });
  const brands = useQuery({ queryKey: ['brands', 'options'], queryFn: () => api<Option[]>('/brands/options') });
  const categories = useQuery({ queryKey: ['categories', 'options', 0], queryFn: () => api<Option[]>('/categories/options', { query: { parentId: 0 } }) });
  const subCategories = useQuery({
    queryKey: ['categories', 'options', filters.categoryId],
    queryFn: () => api<Option[]>('/categories/options', { query: { parentId: filters.categoryId } }),
    enabled: !!filters.categoryId,
  });
  const taxes = useQuery({ queryKey: ['tax-rates', 'options'], queryFn: () => api<Option[]>('/tax-rates/options') });
  const locations = useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['products'] });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      fail(e);
      setDeleting(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: (p: ProductRow) => api(`/products/${p.id}/${p.is_inactive ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(c('saved'));
      refresh();
    },
    onError: fail,
  });

  const duplicate = useMutation({
    mutationFn: (id: number) => api<{ id: number }>(`/products/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (p) => {
      toast.success(t('duplicated'));
      router.push(`/m/products/${p.id}/edit`);
    },
    onError: fail,
  });

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => api<{ done: number; failed: { id: number; name: string; reason: string }[] }>('/products/bulk-action', { method: 'POST', body: { action, ids: selected } }),
    onSuccess: (res) => {
      if (res.failed.length > 0) toast.error(t('bulkPartial', { done: res.done, failed: res.failed.length, first: `${res.failed[0].name}: ${res.failed[0].reason}` }));
      else toast.success(t('bulkDone', { count: res.done }));
      setSelected([]);
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      fail(e);
      setDeleting(null);
    },
  });

  const rows = list.data?.data;
  const pageIds = rows?.map((r) => r.id) ?? [];
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const toggleOne = (id: number) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'categoryId' ? { subCategoryId: '' } : {}) }));
  const filtersActive = Object.values(filters).some(Boolean);

  const priceRange = (min: string | null, max: string | null, type: string) => {
    if (min === null) return '-';
    return type === 'variable' && max !== null && max !== min ? `${formatMoney(min)} - ${formatMoney(max)}` : formatMoney(min);
  };

  const canSeePurchase = rows?.some((r) => r.min_purchase_price !== null) ?? false;

  const columns: Column<ProductRow>[] = [
    {
      key: 'select',
      header: t('select'),
      className: 'w-10',
      cell: (p) => <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary" checked={selected.includes(p.id)} onChange={() => toggleOne(p.id)} aria-label={`${t('select')} ${p.name}`} />,
    },
    {
      key: 'name',
      header: t('columns.product'),
      sortBy: 'name',
      cell: (p) => (
        <div className="min-w-[10rem]">
          <Link href={`/m/products/${p.id}`} className="font-medium text-slate-900 hover:text-primary-dark hover:underline">
            {p.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {p.is_inactive && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t('inactive')}</span>}
            {p.not_for_selling && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t('notForSelling')}</span>}
          </div>
        </div>
      ),
    },
    { key: 'sku', header: t('columns.sku'), sortBy: 'sku', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
    { key: 'type', header: t('columns.type'), sortBy: 'type', cell: (p) => t(`types.${p.type}`) },
    {
      key: 'category',
      header: t('columns.category'),
      sortBy: 'category',
      cell: (p) => (
        <>
          {p.category ?? '-'}
          {p.sub_category && <div className="text-xs text-slate-500">{p.sub_category}</div>}
        </>
      ),
    },
    { key: 'brand', header: t('columns.brand'), sortBy: 'brand', cell: (p) => p.brand ?? '-' },
    {
      key: 'stock',
      header: t('columns.stock'),
      sortBy: 'current_stock',
      cell: (p) => (
        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STOCK_STYLE[p.stock_status])}>
          {p.enable_stock ? `${Number(p.current_stock ?? 0)} ${p.unit ?? ''}` : t('stock.not_tracked')}
          {p.stock_status === 'low_stock' && <span>- {t('stock.low_stock')}</span>}
          {p.stock_status === 'out_of_stock' && <span>- {t('stock.out_of_stock')}</span>}
        </span>
      ),
    },
    ...(canSeePurchase
      ? [{ key: 'purchase', header: t('columns.purchasePrice'), sortBy: 'purchase_price', cell: (p: ProductRow) => <span className="whitespace-nowrap">{priceRange(p.min_purchase_price, p.max_purchase_price, p.type)}</span> }]
      : []),
    { key: 'price', header: t('columns.sellingPrice'), sortBy: 'selling_price', cell: (p) => <span className="whitespace-nowrap">{priceRange(p.min_price, p.max_price, p.type)}</span> },
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-44',
      cell: (p) => (
        <div className="flex flex-wrap gap-0.5">
          {can('product.view') && (
            <Link href={`/m/products/${p.id}`} className="inline-flex h-8 items-center rounded-lg px-2 text-slate-600 hover:bg-slate-100" aria-label={`${t('view')} ${p.name}`}>
              <Eye className="h-4 w-4" />
            </Link>
          )}
          {can('product.update') && (
            <Link href={`/m/products/${p.id}/edit`} className="inline-flex h-8 items-center rounded-lg px-2 text-slate-600 hover:bg-slate-100" aria-label={`${c('edit')} ${p.name}`}>
              <Pencil className="h-4 w-4" />
            </Link>
          )}
          {p.enable_stock && can('product.opening_stock') && (
            <Link href={`/m/products/${p.id}/opening-stock`} className="inline-flex h-8 items-center rounded-lg px-2 text-slate-600 hover:bg-slate-100" aria-label={`${t('openingStock')} ${p.name}`}>
              <Database className="h-4 w-4" />
            </Link>
          )}
          {can('product.create') && (
            <Button variant="ghost" size="sm" onClick={() => duplicate.mutate(p.id)} disabled={duplicate.isPending} aria-label={`${t('duplicate')} ${p.name}`}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {can('product.update') && (
            <Button variant="ghost" size="sm" onClick={() => toggleActive.mutate(p)} disabled={toggleActive.isPending} aria-label={`${p.is_inactive ? t('activate') : t('deactivate')} ${p.name}`}>
              {p.is_inactive ? <Power className="h-4 w-4 text-emerald-600" /> : <PowerOff className="h-4 w-4" />}
            </Button>
          )}
          {can('product.delete') && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(p)} aria-label={`${c('delete')} ${p.name}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const confirmDelete = () => {
    if (deleting === 'selected') bulk.mutate('delete');
    else if (deleting) remove.mutate(deleting.id);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can('product.create') && (
            <Link href="/m/products/new" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-dark">
              <Plus className="h-4 w-4" />
              {t('add')}
            </Link>
          )
        }
      />

      <Card className="mb-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect id="f-type" label={t('filters.type')} value={filters.type} onChange={(v) => setFilter('type', v)} allLabel={t('filters.all')}>
            {(['single', 'variable', 'combo'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-category" label={t('filters.category')} value={filters.categoryId} onChange={(v) => setFilter('categoryId', v)} allLabel={t('filters.all')}>
            {(categories.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-subcategory" label={t('filters.subCategory')} value={filters.subCategoryId} onChange={(v) => setFilter('subCategoryId', v)} allLabel={t('filters.all')} disabled={!filters.categoryId}>
            {(subCategories.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-brand" label={t('filters.brand')} value={filters.brandId} onChange={(v) => setFilter('brandId', v)} allLabel={t('filters.all')}>
            {(brands.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-unit" label={t('filters.unit')} value={filters.unitId} onChange={(v) => setFilter('unitId', v)} allLabel={t('filters.all')}>
            {(units.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-tax" label={t('filters.tax')} value={filters.taxId} onChange={(v) => setFilter('taxId', v)} allLabel={t('filters.all')}>
            {(taxes.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-location" label={t('filters.location')} value={filters.locationId} onChange={(v) => setFilter('locationId', v)} allLabel={t('filters.all')}>
            <option value="none">{t('filters.noLocation')}</option>
            {(locations.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-stock" label={t('filters.stock')} value={filters.stockStatus} onChange={(v) => setFilter('stockStatus', v)} allLabel={t('filters.all')}>
            {(['in_stock', 'low_stock', 'out_of_stock', 'not_tracked'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`stock.${x}`)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect id="f-active" label={t('filters.status')} value={filters.activeState} onChange={(v) => setFilter('activeState', v)} allLabel={t('filters.all')}>
            <option value="active">{c('active')}</option>
            <option value="inactive">{c('inactive')}</option>
          </FilterSelect>
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
            {t('filters.clear')}
          </Button>
        )}
      </Card>

      {rows && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <Checkbox
            id="select-all"
            label={t('selectAllOnPage')}
            checked={allSelected}
            onChange={() => setSelected(allSelected ? selected.filter((id) => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])])}
          />
          {selected.length > 0 && (
            <>
              <span className="text-slate-500">{t('selectedCount', { count: selected.length })}</span>
              {can('product.update') && (
                <>
                  <Button variant="outline" size="sm" onClick={() => bulk.mutate('deactivate')} disabled={bulk.isPending}>
                    {t('deactivateSelected')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => bulk.mutate('activate')} disabled={bulk.isPending}>
                    {t('activateSelected')}
                  </Button>
                </>
              )}
              {can('product.delete') && (
                <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setDeleting('selected')} disabled={bulk.isPending}>
                  {t('deleteSelected')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        emptyMessage={filtersActive || debounced ? t('noMatches') : t('empty')}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        busy={remove.isPending || bulk.isPending}
        onConfirm={confirmDelete}
        title={deleting === 'selected' ? t('deleteSelectedTitle', { count: selected.length }) : t('deleteTitle')}
        body={t('deleteBody')}
      />
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  allLabel,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{allLabel}</option>
        {children}
      </Select>
    </div>
  );
}
