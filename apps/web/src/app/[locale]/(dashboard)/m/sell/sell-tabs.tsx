'use client';

import { useTranslations } from 'next-intl';
import { useCan } from '@/components/providers';
import { SubNav } from '@/components/sub-nav';

/** Tab bar of the Sales & POS module. Each tab is owned by a different work stream; labels live in messages/modules/sell.*.json. */
export function SellTabs() {
  const t = useTranslations('sell');
  const can = useCan();
  return (
    <SubNav
      items={[
        { href: '/m/sell/pos', label: t('tabPos'), visible: can('sell.create') },
        { href: '/m/sell/sales', label: t('tabSales'), visible: can('sell.view', 'direct_sell.access', 'view_own_sell_only') },
        { href: '/m/sell/new', label: t('tabNewSale'), visible: can('direct_sell.access') },
        { href: '/m/sell/drafts', label: t('tabDrafts'), visible: can('list_drafts') },
        { href: '/m/sell/quotations', label: t('tabQuotations'), visible: can('list_quotations') },
        { href: '/m/sell/returns', label: t('tabReturns'), visible: can('access_sell_return', 'access_own_sell_return') },
        { href: '/m/sell/register', label: t('tabRegister'), visible: can('view_cash_register') },
      ]}
    />
  );
}
