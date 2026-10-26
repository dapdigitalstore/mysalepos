'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/page-header';
import { useCan, useSession } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/client-api';
import { useDateTimeFormatter } from './register-format';
import { PrintStyles } from './print-styles';
import { RegisterSummary } from './register-summary';
import { REGISTER_KEYS, type RegisterDetails } from './register-types';

/** Loads the details of the user's open register (`id` undefined) or of register `id`. Shared by the details and close screens. */
export function useRegisterDetails(id?: number) {
  return useQuery({
    queryKey: [...REGISTER_KEYS.details, id ?? 'current'],
    queryFn: () => api<RegisterDetails>(id === undefined ? '/cash-registers/current/details' : `/cash-registers/${id}/details`),
    staleTime: 0,
  });
}

/** Register details page (Laravel: cash_register.register_details), printable. */
export function RegisterDetailsView({ id }: { id?: number }) {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const can = useCan();
  const session = useSession();
  const q = useRegisterDetails(id);
  const fmt = useDateTimeFormatter(q.data?.timeZone ?? 'UTC');

  const backLink = (
    <Link href="/m/sell/register" className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
      {t('back')}
    </Link>
  );

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-4xl" aria-busy="true">
        <PageHeader title={t('registerDetailsTitle')} actions={backLink} />
        <Card className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 10}%` }} />
          ))}
        </Card>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t('registerDetailsTitle')} actions={backLink} />
        <Card>
          <p role="alert" className="text-sm text-red-700">
            {c('loadError')}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }

  const data = q.data;
  const isOpen = data.register.status === 'open';
  const closeHref = id === undefined || data.register.userId === session.id ? '/m/sell/register/close' : `/m/sell/register/${data.register.id}/close`;

  return (
    <div className="mx-auto max-w-4xl">
      <PrintStyles />
      <PageHeader
        title={`${t('registerDetailsTitle')} - ${t('registerNumber', { id: data.register.id })}`}
        description={t('period', { from: fmt(data.register.openedAt), to: isOpen ? fmt(data.closeTime) : fmt(data.register.closedAt) })}
        actions={
          <>
            {backLink}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              {t('print')}
            </Button>
            {isOpen && can('close_cash_register') && (
              <Link href={closeHref} className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700">
                <Lock className="h-4 w-4" />
                {t('closeRegister')}
              </Link>
            )}
          </>
        }
      />
      <Card id="register-print-area">
        <RegisterSummary data={data} />
      </Card>
    </div>
  );
}
