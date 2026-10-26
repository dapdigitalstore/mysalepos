'use client';

import { useTranslations } from 'next-intl';
import { CrudManager, type FieldDef } from '@/components/crud-manager';
import type { Column } from '@/components/data-table';

interface Category {
  id: number;
  name: string;
  short_code: string | null;
  description: string | null;
  parent_id: number;
  parent_name: string | null;
}

export function CategoriesManager() {
  const t = useTranslations('categories');
  const columns: Column<Category>[] = [
    { key: 'name', header: t('name'), sortBy: 'name', cell: (cat) => (cat.parent_id > 0 ? <span className="ps-4 text-slate-600">— {cat.name}</span> : <strong>{cat.name}</strong>) },
    { key: 'short_code', header: t('shortCode'), sortBy: 'short_code', cell: (cat) => cat.short_code ?? '' },
    { key: 'parent', header: t('parent'), cell: (cat) => cat.parent_name ?? '' },
    { key: 'description', header: t('description'), cell: (cat) => cat.description ?? '' },
  ];
  const fields: FieldDef[] = [
    { name: 'name', label: t('name'), type: 'text', required: true },
    { name: 'shortCode', label: t('shortCode'), type: 'text' },
    { name: 'description', label: t('description'), type: 'textarea' },
    { name: 'parentId', label: t('parent'), type: 'select', optionsPath: '/categories/options', emptyLabel: t('noParent'), hint: t('parentHint') },
  ];
  return (
    <CrudManager<Category>
      namespace="categories"
      resource="/categories"
      queryKey="categories"
      permissions={{ view: ['category.view', 'category.create'], create: 'category.create', update: 'category.update', delete: 'category.delete' }}
      columns={columns}
      fields={fields}
      defaultSort={{ sortBy: 'name', sortDir: 'asc' }}
      toValues={(cat) => ({ name: cat.name, shortCode: cat.short_code ?? '', description: cat.description ?? '', parentId: cat.parent_id > 0 ? String(cat.parent_id) : '' })}
      toPayload={(v) => ({ name: v.name, shortCode: v.shortCode || null, description: v.description || null, parentId: v.parentId ? Number(v.parentId) : 0 })}
      rowLabel={(cat) => cat.name}
      excludeSelf
    />
  );
}
