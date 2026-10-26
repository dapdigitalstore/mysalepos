'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/components/providers';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface CatalogItem {
  name: string;
  label: string;
  radio?: string;
  default?: boolean;
  dynamic?: boolean;
}

interface CatalogGroup {
  key: string;
  label: string;
  items: CatalogItem[];
}

interface Catalog {
  groups: CatalogGroup[];
  serviceStaff: boolean;
}

interface RoleDetail {
  id: number;
  name: string;
  isAdmin: boolean;
  isServiceStaff: boolean;
  locked: boolean;
  permissions: string[];
}

export function RoleEditor({ roleId }: { roleId?: number }) {
  const t = useTranslations('roles');
  const c = useTranslations('common');
  const router = useRouter();
  const isNew = roleId === undefined;

  const catalog = useQuery({ queryKey: ['permissions', 'catalog'], queryFn: () => api<Catalog>('/permissions/catalog'), gcTime: 0 });
  const role = useQuery({ queryKey: ['roles', 'detail', roleId], queryFn: () => api<RoleDetail>(`/roles/${roleId}`), enabled: !isNew, gcTime: 0 });

  const failed = catalog.isError || role.isError;
  const ready = catalog.data && (isNew || role.data);

  return (
    <div>
      <PageHeader
        title={isNew ? t('add') : role.data?.locked ? t('view') : t('edit')}
        actions={
          <Button variant="outline" onClick={() => router.push('/m/users/roles')}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('backToList')}
          </Button>
        }
      />
      {failed && (
        <Card role="alert" className="flex items-center justify-between gap-3 text-sm text-red-700">
          <span>{t('loadError')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void catalog.refetch();
              if (!isNew) void role.refetch();
            }}
          >
            {c('retry')}
          </Button>
        </Card>
      )}
      {!failed && !ready && (
        <Card className="space-y-3" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </Card>
      )}
      {!failed && catalog.data && (isNew || role.data) && <EditorForm roleId={roleId} catalog={catalog.data} role={role.data ?? null} />}
    </div>
  );
}

function EditorForm({ roleId, catalog, role }: { roleId?: number; catalog: Catalog; role: RoleDetail | null }) {
  const t = useTranslations('roles');
  const c = useTranslations('common');
  const p = useTranslations('permissionLabels');
  const can = useCan();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const locked = role?.locked ?? false;
  const canSave = !locked && (roleId === undefined ? can('roles.create') : can('roles.update'));

  // The stored name is edited as is (translating "Cashier" here would rename the role on save); only the locked Admin role is translated.
  const [name, setName] = useState(role ? (role.locked && role.name === 'Admin' ? t('roleAdmin') : role.name) : '');
  const [nameTouched, setNameTouched] = useState(false);
  const [isServiceStaff, setIsServiceStaff] = useState(role?.isServiceStaff ?? false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role ? role.permissions : catalog.groups.flatMap((g) => g.items.filter((i) => i.default).map((i) => i.name))),
  );

  // Translated label, falling back to the English text from the API (selling price groups are user data).
  const permLabel = (i: CatalogItem) => {
    const key = `perm.${i.name.replace(/\./g, '__')}`;
    return !i.dynamic && p.has(key) ? p(key) : i.label;
  };
  const groupLabel = (g: CatalogGroup) => (p.has(`group.${g.key}`) ? p(`group.${g.key}`) : g.label);

  const needle = search.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      catalog.groups
        .map((g) => ({ g, items: g.items.filter((i) => !needle || permLabel(i).toLowerCase().includes(needle) || groupLabel(g).toLowerCase().includes(needle)) }))
        .filter((x) => x.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.groups, needle, p],
  );

  const toggle = (g: CatalogGroup, item: CatalogItem) => {
    if (locked) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(item.name)) {
        next.delete(item.name);
      } else {
        // radio items are mutually exclusive inside their group
        if (item.radio) for (const o of g.items) if (o.radio === item.radio) next.delete(o.name);
        next.add(item.name);
      }
      return next;
    });
  };

  const groupAllSelected = (g: CatalogGroup) => {
    const radios = new Set(g.items.filter((i) => i.radio).map((i) => i.radio));
    const boxesOk = g.items.filter((i) => !i.radio).every((i) => selected.has(i.name));
    const radiosOk = [...radios].every((r) => g.items.some((i) => i.radio === r && selected.has(i.name)));
    return boxesOk && radiosOk;
  };

  const toggleGroup = (g: CatalogGroup) => {
    if (locked) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (groupAllSelected(g)) {
        for (const i of g.items) next.delete(i.name);
      } else {
        const seenRadio = new Set<string>();
        for (const i of g.items) {
          if (!i.radio) next.add(i.name);
          else if (!seenRadio.has(i.radio) && !g.items.some((o) => o.radio === i.radio && next.has(o.name))) {
            seenRadio.add(i.radio); // first option of a radio group is "view all"
            next.add(i.name);
          }
        }
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), isServiceStaff, permissions: [...selected] };
      return roleId === undefined ? api('/roles', { method: 'POST', body }) : api(`/roles/${roleId}`, { method: 'PUT', body });
    },
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: ['roles'] });
      router.push('/m/users/roles');
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const nameInvalid = name.trim() === '' || name.includes('#');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setNameTouched(true);
        if (!nameInvalid) save.mutate();
      }}
      className="space-y-5"
      noValidate
    >
      {locked && (
        <Card role="note" className="text-sm text-slate-700">
          {role?.isAdmin ? t('adminLocked') : t('defaultLocked')}
        </Card>
      )}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('name')} htmlFor="roleName" error={nameTouched && nameInvalid ? t('vName') : undefined} required>
            <Input id="roleName" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} disabled={locked} maxLength={80} autoFocus={!locked} />
          </Field>
          {catalog.serviceStaff && (
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700" title={t('isServiceStaffHint')}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  checked={isServiceStaff}
                  disabled={locked}
                  onChange={(e) => setIsServiceStaff(e.target.checked)}
                />
                {t('isServiceStaff')}
              </label>
            </div>
          )}
        </div>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{t('permissions')}</h2>
          <span className="text-sm text-slate-500" aria-live="polite">
            {t('selectedCount', { count: selected.size })}
          </span>
        </div>
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPermissions')} className="ps-9" aria-label={t('searchPermissions')} />
        </div>
        <p className="mb-3 text-xs text-slate-500">{t('clearChoice')}</p>

        {visibleGroups.length === 0 && <Card className="text-center text-sm text-slate-500">{t('noPermissionMatch')}</Card>}
        <div className="space-y-3">
          {visibleGroups.map(({ g, items }) => (
            <Card key={g.key} className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-800">{groupLabel(g)}</h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={locked || groupAllSelected(g)}
                    disabled={locked}
                    onChange={() => toggleGroup(g)}
                    aria-label={`${t('selectAll')}: ${groupLabel(g)}`}
                  />
                  {t('selectAll')}
                </label>
              </div>
              <ul className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2">
                {items.map((i) => {
                  const checked = locked || selected.has(i.name);
                  return (
                    <li key={i.name}>
                      <label className={cn('flex items-start gap-2 text-sm text-slate-700', locked ? 'cursor-default' : 'cursor-pointer')}>
                        <input
                          type={i.radio ? 'radio' : 'checkbox'}
                          name={i.radio ? `${g.key}-${i.radio}` : undefined}
                          className={cn('mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-primary focus:ring-primary', i.radio ? 'rounded-full' : 'rounded')}
                          checked={checked}
                          disabled={locked}
                          // radios are toggled in onClick so a second click clears the choice
                          onChange={() => (i.radio ? undefined : toggle(g, i))}
                          onClick={() => (i.radio ? toggle(g, i) : undefined)}
                        />
                        <span>{permLabel(i)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push('/m/users/roles')} disabled={save.isPending}>
          {c('cancel')}
        </Button>
        {canSave && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        )}
      </div>
    </form>
  );
}
