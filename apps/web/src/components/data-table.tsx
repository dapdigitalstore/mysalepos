'use client';

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Card } from './ui/card';

export interface Column<T> {
  key: string;
  header: string;
  /** API column name to sort by; omit to make the column unsortable. */
  sortBy?: string;
  cell?: (row: T) => React.ReactNode;
  className?: string;
}

export interface SortState {
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  meta?: { page: number; perPage: number; total: number; totalPages: number };
  onPageChange?: (page: number) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  emptyMessage?: string;
}

/** Server-paginated table with loading, empty and error states. Used by every list screen. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, meta, onPageChange, sort, onSortChange, emptyMessage }: Props<T>) {
  const t = useTranslations('common');

  const toggleSort = (col: Column<T>) => {
    if (!col.sortBy || !onSortChange) return;
    onSortChange({ sortBy: col.sortBy, sortDir: sort?.sortBy === col.sortBy && sort.sortDir === 'asc' ? 'desc' : 'asc' });
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3 text-start font-semibold', c.className)} aria-sort={sort && c.sortBy && sort.sortBy === c.sortBy ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortBy && onSortChange ? (
                    <button type="button" onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 hover:text-slate-800">
                      {c.header}
                      {sort?.sortBy === c.sortBy && (sort.sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows?.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 text-slate-700', c.className)}>
                      {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm text-red-700">
          <span>{error}</span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('retry')}
            </Button>
          )}
        </div>
      )}
      {!loading && !error && rows && rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">{emptyMessage ?? t('noResults')}</p>}

      {meta && meta.total > 0 && onPageChange && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>{t('pageOf', { page: meta.page, total: meta.totalPages, count: meta.total })}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label={t('previous')}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </Button>
            <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label={t('next')}>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
