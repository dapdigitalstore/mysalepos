'use client';

import { useTranslations } from 'next-intl';
import { CrudManager, type FieldDef } from '@/components/crud-manager';
import type { Column } from '@/components/data-table';

interface Brand {
  id: number;
  name: string;
  description: string | null;
}

export function BrandsManager() {
  const t = useTranslations('brands');
  const columns: Column<Brand>[] = [
    { key: 'name', header: t('name'), sortBy: 'name' },
    { key: 'description', header: t('description'), cell: (b) => b.description ?? '' },
  ];
  const fields: FieldDef[] = [
    { name: 'name', label: t('name'), type: 'text', required: true },
    { name: 'description', label: t('description'), type: 'textarea' },
  ];
  return (
    <CrudManager<Brand>
      namespace="brands"
      resource="/brands"
      queryKey="brands"
      permissions={{ view: ['brand.view', 'brand.create'], create: 'brand.create', update: 'brand.update', delete: 'brand.delete' }}
      columns={columns}
      fields={fields}
      defaultSort={{ sortBy: 'name', sortDir: 'asc' }}
      toValues={(b) => ({ name: b.name, description: b.description ?? '' })}
      toPayload={(v) => ({ name: v.name, description: v.description || null })}
      rowLabel={(b) => b.name}
    />
  );
}
