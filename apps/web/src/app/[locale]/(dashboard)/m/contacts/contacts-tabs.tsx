'use client';

import { useTranslations } from 'next-intl';
import { SubNav } from '@/components/sub-nav';
import { useCan } from '@/components/providers';

export function ContactsTabs() {
  const t = useTranslations('contacts');
  const can = useCan();
  return (
    <SubNav
      items={[
        { href: '/m/contacts/suppliers', label: t('tabSuppliers'), visible: can('supplier.view', 'supplier.view_own') },
        { href: '/m/contacts/customers', label: t('tabCustomers'), visible: can('customer.view', 'customer.view_own') },
        { href: '/m/contacts/groups', label: t('tabGroups'), visible: can('customer.view') },
      ]}
    />
  );
}
