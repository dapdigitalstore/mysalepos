'use client';

import { useTranslations } from 'next-intl';
import { SubNav } from '@/components/sub-nav';
import { useCan } from '@/components/providers';

/** Tab bar of the Products module. The last six pages are built by other work streams. */
export function ProductsTabs() {
  const t = useTranslations('products');
  const can = useCan();
  return (
    <SubNav
      items={[
        { href: '/m/products', label: t('tabs.products') },
        { href: '/m/products/new', label: t('tabs.add'), visible: can('product.create') },
        { href: '/m/products/variations', label: t('tabs.variations') },
        { href: '/m/products/warranties', label: t('tabs.warranties') },
        { href: '/m/products/price-groups', label: t('tabs.priceGroups') },
        { href: '/m/products/units', label: t('tabs.units') },
        { href: '/m/products/brands', label: t('tabs.brands') },
        { href: '/m/products/categories', label: t('tabs.categories') },
      ]}
    />
  );
}
