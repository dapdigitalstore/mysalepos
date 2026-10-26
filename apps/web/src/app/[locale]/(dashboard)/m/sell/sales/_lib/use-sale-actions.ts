'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import type { SaleDetail } from './sale-types';

/**
 * Delete / duplicate / convert actions shared by the sales list, the sale detail, drafts and quotations.
 * The API message (English) is shown when it refuses, e.g. a sale that already has a return.
 */
export function useSaleActions(options: { afterDelete?: () => void; canListDrafts?: boolean } = {}) {
  const t = useTranslations('sales');
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sales'] });
  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));

  const remove = useMutation({
    mutationFn: (id: number) => api(`/sales/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('deleted'));
      refresh();
      options.afterDelete?.();
    },
    onError: fail,
  });

  const duplicate = useMutation({
    mutationFn: (id: number) => api<SaleDetail>(`/sales/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (draft) => {
      toast.success(t('duplicated', { no: draft.invoiceNo ?? `#${draft.id}` }));
      refresh();
      if (options.canListDrafts) router.push('/m/sell/drafts');
    },
    onError: fail,
  });

  const convertToInvoice = useMutation({
    mutationFn: (id: number) => api<SaleDetail>(`/sales/${id}/convert-to-invoice`, { method: 'POST' }),
    onSuccess: (sale) => {
      toast.success(t('converted', { no: sale.invoiceNo ?? `#${sale.id}` }));
      refresh();
      router.push(`/m/sell/sales/${sale.id}`);
    },
    onError: fail,
  });

  const convertToProforma = useMutation({
    mutationFn: (id: number) => api<SaleDetail>(`/sales/${id}/convert-to-proforma`, { method: 'POST' }),
    onSuccess: (sale) => {
      toast.success(t('convertedProforma', { no: sale.invoiceNo ?? `#${sale.id}` }));
      refresh();
    },
    onError: fail,
  });

  return { remove, duplicate, convertToInvoice, convertToProforma };
}
