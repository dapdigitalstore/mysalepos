'use client';

import { Eye, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { formatMoney } from '@/lib/utils';
import { OpenRegisterForm } from './open-register-form';
import { useDateTimeFormatter } from './register-format';
import { RegisterReport, StatusBadge } from './register-report';
import { useCurrentRegister } from './register-gate';

/** /m/sell/register: the user's own register (open it, look at it, close it) and, with `register_report.view`, the register report. */
export function RegisterOverview() {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const can = useCan();
  const current = useCurrentRegister();
  const fmt = useDateTimeFormatter(current.data?.timeZone ?? 'UTC');

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <section aria-label={t('currentRegister')}>
        {current.isLoading && (
          <Card aria-busy="true">
            <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
            <p className="mt-3 text-sm text-slate-500">{t('checking')}</p>
          </Card>
        )}

        {current.isError && (
          <Card>
            <p role="alert" className="text-sm text-red-700">
              {t('checkError')}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void current.refetch()}>
              {c('retry')}
            </Button>
          </Card>
        )}

        {current.data && current.data.open && current.data.register && (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{t('currentRegister')}</h2>
                  <StatusBadge status="open" />
                </div>
                <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="font-medium text-slate-500">{t('openedAt')}:</dt>
                    <dd className="text-slate-800">{fmt(current.data.register.openedAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-medium text-slate-500">{t('locationLabel')}:</dt>
                    <dd className="text-slate-800">{current.data.register.locationName ?? '-'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="font-medium text-slate-500">{t('sinceOpening')}:</dt>
                    <dd className="tabular-nums text-slate-800">{formatMoney(current.data.register.cashInHand)}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap gap-2">
                {can('view_cash_register') && (
                  <Link href="/m/sell/register/details" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Eye className="h-4 w-4" />
                    {t('viewDetails')}
                  </Link>
                )}
                {can('close_cash_register') && (
                  <Link href="/m/sell/register/close" className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700">
                    <Lock className="h-4 w-4" />
                    {t('closeRegister')}
                  </Link>
                )}
              </div>
            </div>
          </Card>
        )}

        {current.data && !current.data.open && (
          <div className="mx-auto max-w-lg">
            <p className="mb-3 text-sm text-slate-600">{t('noOpenRegister')}</p>
            <OpenRegisterForm />
          </div>
        )}
      </section>

      {can('register_report.view') && <RegisterReport />}
    </div>
  );
}
