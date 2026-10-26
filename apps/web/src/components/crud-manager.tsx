'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { api, ApiError, type Paginated } from '@/lib/client-api';

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox';
  required?: boolean;
  hint?: string;
  /** For `select`: GET path returning [{id,label}] (loaded when the dialog opens). */
  optionsPath?: string;
  /** For `select`: label of the empty choice. */
  emptyLabel?: string;
}

type Values = Record<string, string | boolean>;

interface Props<Row extends { id: number }> {
  /** next-intl namespace holding title, subtitle, add, edit, searchPlaceholder. */
  namespace: string;
  resource: string; // e.g. '/brands'
  queryKey: string;
  permissions: { view: string[]; create: string; update: string; delete: string };
  columns: Column<Row>[];
  fields: FieldDef[];
  defaultSort: SortState;
  /** Form values for a row being edited (all values as strings/booleans). */
  toValues: (row: Row) => Values;
  /** Request body from the form values. */
  toPayload: (values: Values) => unknown;
  rowLabel: (row: Row) => string;
  /** Option ids to hide in a select while editing (e.g. a category cannot be its own parent). */
  excludeSelf?: boolean;
  maxWidth?: string;
}

/** Search + sortable table + add/edit dialog + delete confirm for simple master-data screens. */
export function CrudManager<Row extends { id: number }>(props: Props<Row>) {
  const { namespace, resource, queryKey, permissions, columns, fields, defaultSort, toValues, toPayload, rowLabel, excludeSelf } = props;
  const t = useTranslations(namespace);
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const list = useQuery({
    queryKey: [queryKey, { page, search: debounced, ...sort }],
    queryFn: () => api<Paginated<Row>>(resource, { query: { page, search: debounced, ...sort } }),
    placeholderData: (prev) => prev,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`${resource}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));
      setDeleting(null);
    },
  });

  const allColumns: Column<Row>[] = [
    ...columns,
    {
      key: 'actions',
      header: c('actions'),
      className: 'w-28',
      cell: (row) => (
        <div className="flex gap-1">
          {can(permissions.update) && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)} aria-label={`${c('edit')} ${rowLabel(row)}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can(permissions.delete) && (
            <Button variant="ghost" size="sm" onClick={() => setDeleting(row)} aria-label={`${c('delete')} ${rowLabel(row)}`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={`mx-auto ${props.maxWidth ?? 'max-w-5xl'}`}>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can(permissions.create) && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              {t('add')}
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="ps-9" aria-label={c('search')} />
      </div>
      <DataTable
        columns={allColumns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? c('loadError') : null}
        onRetry={() => void list.refetch()}
        meta={list.data?.meta}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
      />
      <EditDialog<Row>
        target={editing}
        onClose={() => setEditing(null)}
        namespace={namespace}
        resource={resource}
        queryKey={queryKey}
        fields={fields}
        toValues={toValues}
        toPayload={toPayload}
        excludeSelf={excludeSelf}
      />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}

function EditDialog<Row extends { id: number }>({
  target,
  onClose,
  namespace,
  resource,
  queryKey,
  fields,
  toValues,
  toPayload,
  excludeSelf,
}: {
  target: Row | 'new' | null;
  onClose: () => void;
  namespace: string;
  resource: string;
  queryKey: string;
  fields: FieldDef[];
  toValues: (row: Row) => Values;
  toPayload: (values: Values) => unknown;
  excludeSelf?: boolean;
}) {
  const t = useTranslations(namespace);
  const c = useTranslations('common');
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = target === 'new';
  const existing = target && target !== 'new' ? target : null;

  const schema = useMemo(
    () => z.object(Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? z.boolean() : f.required ? z.string().trim().min(1) : z.string()]))),
    [fields],
  );
  const blank = useMemo<Values>(() => Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? false : ''])), [fields]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank });

  useEffect(() => {
    if (target) form.reset(existing ? { ...blank, ...toValues(existing) } : blank);
  }, [target, existing, blank, toValues, form]);

  const save = useMutation({
    mutationFn: (v: Values) =>
      isNew ? api(resource, { method: 'POST', body: toPayload(v) }) : api(`${resource}/${existing?.id}`, { method: 'PUT', body: toPayload(v) }),
    onSuccess: () => {
      toast.success(c('saved'));
      void qc.invalidateQueries({ queryKey: [queryKey] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  return (
    <Dialog open={!!target} onClose={onClose} title={isNew ? t('add') : t('edit')}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        {fields.map((f, i) => (
          <FieldInput key={f.name} def={f} form={form} autoFocus={i === 0} excludeId={excludeSelf ? existing?.id : undefined} error={form.formState.errors[f.name] ? c('required') : undefined} />
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {c('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? c('saving') : c('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FieldInput({ def, form, autoFocus, excludeId, error }: { def: FieldDef; form: ReturnType<typeof useForm<Values>>; autoFocus: boolean; excludeId?: number; error?: string }) {
  const options = useQuery({
    queryKey: ['options', def.optionsPath],
    queryFn: () => api<{ id: number; label: string }[]>(def.optionsPath as string),
    enabled: def.type === 'select' && !!def.optionsPath,
  });
  const reg = form.register(def.name);
  const id = `f-${def.name}`;

  if (def.type === 'checkbox') return <Checkbox id={id} label={def.label} {...reg} />;
  return (
    <Field label={def.label} htmlFor={id} error={error} hint={def.hint} required={def.required}>
      {def.type === 'textarea' ? (
        <Textarea id={id} {...reg} />
      ) : def.type === 'select' ? (
        <Select id={id} {...reg}>
          <option value="">{def.emptyLabel ?? ''}</option>
          {(options.data ?? [])
            .filter((o) => o.id !== excludeId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </Select>
      ) : (
        <Input id={id} type={def.type === 'number' ? 'number' : 'text'} step={def.type === 'number' ? 'any' : undefined} autoFocus={autoFocus} {...reg} />
      )}
    </Field>
  );
}
