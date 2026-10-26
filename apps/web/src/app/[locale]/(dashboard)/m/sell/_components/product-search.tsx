'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ScanBarcode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { cn, formatMoney } from '@/lib/utils';
import { saleApi } from '../_lib/sale-api';
import type { ProductHit } from '../_lib/sale-types';
import { isZero, dec } from '../_lib/decimal';

interface SearchOptions {
  locationId: number | null;
  priceGroupId: number | null;
  /** Hide products without stock (POS when overselling is off). */
  checkQty: boolean;
  limit: number;
}

const searchKey = (term: string, o: SearchOptions) => ['sales', 'product-search', o.locationId, o.priceGroupId, o.checkQty, o.limit, term] as const;

const fetchHits = (term: string, o: SearchOptions) =>
  saleApi<ProductHit[]>('/products/search', {
    query: { term, locationId: o.locationId, priceGroupId: o.priceGroupId, checkQty: o.checkQty, notForSelling: false, limit: o.limit },
  });

/** Price shown on a tile / row: the selling price group price when there is one, else the catalogue price (both include tax). */
export const hitPrice = (h: ProductHit): string => h.group_price ?? h.selling_price;

const same = (a: string | null | undefined, b: string): boolean => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The product a typed code means: an exact SKU / sub-SKU match, else the only hit, else the highlighted (or first) one. */
export function pickHit(hits: ProductHit[], term: string, highlighted: number): ProductHit | null {
  const exact = hits.find((h) => same(h.sub_sku, term) || same(h.sku, term));
  if (exact) return exact;
  if (hits.length === 1) return hits[0];
  return hits[highlighted] ?? hits[0] ?? null;
}

interface Props {
  locationId: number | null;
  priceGroupId: number | null;
  checkQty: boolean;
  /** `grid`: tiles under the box (POS). `dropdown`: a list that opens under the box (forms). */
  layout: 'grid' | 'dropdown';
  /** Show the suggestions while the box is empty (off when the business hides product suggestions). */
  suggestWhenEmpty: boolean;
  /** Adds the variation to the cart; resolves when done. */
  onAdd: (variationId: number) => Promise<unknown> | void;
  inputRef?: RefObject<HTMLInputElement>;
  autoFocus?: boolean;
  adding?: boolean;
  className?: string;
}

/** Search box for products: name / SKU / barcode. Enter adds the exact match (a scanner types the code and presses Enter). */
export function ProductSearch({ locationId, priceGroupId, checkQty, layout, suggestWhenEmpty, onAdd, inputRef, autoFocus, adding, className }: Props) {
  const t = useTranslations('pos');
  const qc = useQueryClient();
  const listId = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term.trim(), 250);
  const opts: SearchOptions = { locationId, priceGroupId, checkQty, limit: layout === 'grid' ? 48 : 12 };
  const wanted = layout === 'grid' ? suggestWhenEmpty || debounced !== '' : debounced !== '';

  const hits = useQuery({
    queryKey: searchKey(debounced, opts),
    queryFn: () => fetchHits(debounced, opts),
    enabled: locationId !== null && wanted,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
  const list = hits.data ?? [];

  useEffect(() => setActive(0), [debounced, locationId]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus, ref]);

  const add = async (variationId: number) => {
    setTerm('');
    setOpen(false);
    await onAdd(variationId);
    ref.current?.focus();
  };

  const onEnter = async () => {
    const typed = term.trim();
    if (typed === '') {
      const pick = list[active];
      if (pick) await add(pick.variation_id);
      return;
    }
    try {
      const fresh = await qc.fetchQuery({ queryKey: searchKey(typed, opts), queryFn: () => fetchHits(typed, opts), staleTime: 5_000 });
      const pick = pickHit(fresh, typed, debounced === typed ? active : 0);
      if (pick) await add(pick.variation_id);
    } catch {
      /* the list below shows the error */
    }
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
      void onEnter();
    } else if (e.key === 'Escape') {
      setOpen(false);
      if (term) setTerm('');
    }
  };

  const showList = layout === 'grid' ? wanted : open && wanted;

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          ref={ref}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          aria-controls={listId}
          aria-expanded={showList}
          role="combobox"
          autoComplete="off"
          className="h-12 ps-10 pe-10 text-base"
          disabled={locationId === null}
        />
        {(adding || hits.isFetching) && <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden="true" />}
      </div>

      {showList && (
        <div id={listId} role="listbox" aria-label={t('searchResults')} className={layout === 'grid' ? 'mt-3' : 'absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg'}>
          {hits.isError ? (
            <p role="alert" className="p-3 text-sm text-red-700">
              {t('searchError')}
            </p>
          ) : hits.isLoading ? (
            <p className="p-3 text-sm text-slate-500">{t('searching')}</p>
          ) : list.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">{t('noProducts')}</p>
          ) : layout === 'grid' ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {list.map((h, i) => (
                <li key={h.variation_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void add(h.variation_id)}
                    className={cn(
                      'flex h-full min-h-[88px] w-full flex-col justify-between rounded-lg border bg-white p-2.5 text-start shadow-sm transition hover:border-primary hover:shadow focus-visible:border-primary',
                      i === active ? 'border-primary ring-2 ring-primary/30' : 'border-slate-200',
                    )}
                  >
                    <span className="line-clamp-2 text-sm font-medium text-slate-900">{h.type === 'variable' && h.variation ? `${h.name} - ${h.variation}` : h.name}</span>
                    <span className="mt-1 flex items-end justify-between gap-1">
                      <span className="text-sm font-semibold text-primary-dark">{formatMoney(hitPrice(h))}</span>
                      <StockBadge hit={h} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {list.map((h, i) => (
                <li key={h.variation_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void add(h.variation_id)}
                    className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm', i === active ? 'bg-primary-light/60' : 'hover:bg-slate-50')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{h.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <StockBadge hit={h} />
                      <span className="font-semibold text-slate-700">{formatMoney(hitPrice(h))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StockBadge({ hit }: { hit: ProductHit }) {
  const t = useTranslations('pos');
  if (!hit.enable_stock || hit.qty_available === null) return null;
  const out = isZero(dec(hit.qty_available)) || hit.qty_available.startsWith('-');
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', out ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')} title={t('inStock')}>
      {hit.qty_available}
      {hit.unit ? ` ${hit.unit}` : ''}
    </span>
  );
}
