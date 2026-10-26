'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCan } from '@/components/providers';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/utils';
import { saleApi } from '../_lib/sale-api';
import type { SaleListResponse, SaleListRow } from '../_lib/sale-types';
import { formatInstant } from '../_lib/time';
import { SALE_KEYS } from '../_components/use-sale-settings';
import { useSaleError } from '../_components/use-sale-error';

interface Props {
  open: boolean;
  onClose: () => void;
  timeZone: string;
  onResume: (id: number) => void;
}

/** Suspended (held) POS sales: `GET /sales?isSuspend=true&isDirectSale=false`. Resume loads one back into the cart. */
export function SuspendedDialog({ open, onClose, timeZone, onResume }: Props) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const locale = useLocale();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const describe = useSaleError();
  const [toDelete, setToDelete] = useState<SaleListRow | null>(null);

  const list = useQuery({
    queryKey: SALE_KEYS.suspended,
    queryFn: () => saleApi<SaleListResponse>('/sales', { query: { isSuspend: true, isDirectSale: false, perPage: 50, sortBy: 'transaction_date', sortDir: 'desc' } }),
    enabled: open,
    staleTime: 0,
  });

  const remove = useMutation({
    mutationFn: (id: number) => saleApi(`/sales/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('suspendedDeleted'));
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (e) => {
      toast.error(describe(e));
      setToDelete(null);
    },
  });

  const rows = list.data?.data ?? [];
  const canDelete = can('sell.delete', 'direct_sell.delete');

  return (
    <>
      <Dialog open={open} onClose={onClose} title={t('suspendedTitle')} className="max-w-2xl">
        {list.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-500">{c('loading')}</p>
        ) : list.isError ? (
          <div className="py-4 text-center">
            <p role="alert" className="text-sm text-red-700">
              {c('loadError')}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
              {c('retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('suspendedEmpty')}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-auto">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{s.contactName ?? t('walkIn')}</p>
                  <p className="text-xs text-slate-500">
                    {s.invoiceNo ? `${s.invoiceNo} - ` : ''}
                    {formatInstant(s.transactionDate, timeZone, locale)}
                    {s.totalItems !== null && ` - ${t('itemsCount', { count: Number(s.totalItems) })}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{formatMoney(s.finalTotal)}</span>
                  <Button size="sm" onClick={() => onResume(s.id)}>
                    {t('resume')}
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setToDelete(s)}>
                      {c('delete')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        busy={remove.isPending}
        title={t('suspendedDeleteTitle')}
        body={t('suspendedDeleteBody')}
      />
    </>
  );
}
