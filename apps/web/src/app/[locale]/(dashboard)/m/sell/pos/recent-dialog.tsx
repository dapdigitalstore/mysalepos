'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Link } from '@/i18n/routing';
import { cn, formatMoney } from '@/lib/utils';
import { saleApi } from '../_lib/sale-api';
import type { RecentSale } from '../_lib/sale-types';
import { formatInstant } from '../_lib/time';
import { SALE_KEYS } from '../_components/use-sale-settings';

type Tab = 'final' | 'draft' | 'quotation';

interface Props {
  open: boolean;
  onClose: () => void;
  timeZone: string;
  canPrint: boolean;
  /** Load a draft / quotation back into the cart. */
  onOpenDraft: (id: number) => void;
}

/** "Recent transactions": the user's latest POS sales, drafts and quotations (`GET /sales/recent`). */
export function RecentDialog({ open, onClose, timeZone, canPrint, onOpenDraft }: Props) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const locale = useLocale();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('final');
  const tabs: Tab[] = ['final', ...(can('list_drafts') ? (['draft'] as const) : []), ...(can('list_quotations') ? (['quotation'] as const) : [])];

  const list = useQuery({
    queryKey: [...SALE_KEYS.recent, tab],
    queryFn: () => saleApi<RecentSale[]>('/sales/recent', { query: { status: tab, limit: 15 } }),
    enabled: open,
    staleTime: 0,
  });
  const rows = list.data ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={t('recentTitle')} className="max-w-2xl">
      <div role="tablist" aria-label={t('recentTitle')} className="mb-3 flex gap-1 border-b border-slate-200">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary text-primary-dark' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            {t(`recentTab.${k}`)}
          </button>
        ))}
      </div>

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
        <p className="py-6 text-center text-sm text-slate-500">{t('recentEmpty')}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-auto">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{s.contactName ?? t('walkIn')}</p>
                <p className="text-xs text-slate-500">
                  {s.invoiceNo ? `${s.invoiceNo} - ` : ''}
                  {formatInstant(s.transactionDate, timeZone, locale)}
                  {s.isSuspend && ` - ${t('suspendedBadge')}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{formatMoney(s.finalTotal)}</span>
                {tab === 'final' ? (
                  <>
                    <Link href={`/m/sell/sales/${s.id}`} className="rounded-lg px-2 py-1.5 text-sm font-medium text-primary-dark hover:bg-primary-light/50">
                      {t('view')}
                    </Link>
                    {canPrint && (
                      <Link href={`/m/sell/sales/${s.id}/print`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-primary-dark hover:bg-primary-light/50">
                        <Printer className="h-4 w-4" aria-hidden="true" />
                        {t('print')}
                      </Link>
                    )}
                  </>
                ) : (
                  <Button size="sm" onClick={() => onOpenDraft(s.id)}>
                    {t('openInCart')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
