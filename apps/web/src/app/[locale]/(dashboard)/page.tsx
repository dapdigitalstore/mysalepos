import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Boxes, Receipt, ShoppingCart, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { apiGet, type DashboardSummary, type MeResponse } from '@/lib/api';
import { formatMoney } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');
  const me = await apiGet<MeResponse>('/auth/me');
  const summary = await apiGet<DashboardSummary>('/dashboard/summary').catch(() => null);

  const stats = summary
    ? [
        { label: t('salesMonth'), value: formatMoney(summary.salesThisMonth.total), sub: t('orders', { count: summary.salesThisMonth.count }), Icon: ShoppingCart },
        { label: t('purchasesMonth'), value: formatMoney(summary.purchasesThisMonth.total), sub: t('orders', { count: summary.purchasesThisMonth.count }), Icon: Receipt },
        { label: t('products'), value: String(summary.products), sub: null, Icon: Boxes },
        { label: t('contacts'), value: String(summary.contacts), sub: null, Icon: Users },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">{t('welcome', { name: me.user.firstName })}</h1>
      <p className="mb-6 mt-1 text-slate-500">{t('subtitle', { business: me.business?.name ?? '' })}</p>

      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({ label, value, sub, Icon }) => (
            <Card key={label}>
              <div className="flex items-start justify-between">
                <p className="text-sm text-slate-500">{label}</p>
                <span className="rounded-lg bg-primary-light p-2 text-primary-dark">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
              {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
            </Card>
          ))}
        </div>
      ) : (
        <Card role="alert" className="text-red-700">{t('loadError')}</Card>
      )}

      <p className="mt-8 text-sm text-slate-500">{t('modulesHint')}</p>
    </div>
  );
}
