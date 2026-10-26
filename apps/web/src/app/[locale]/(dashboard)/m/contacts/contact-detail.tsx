'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Power, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { Badge } from './contact-badge';
import { ContactDialog } from './contact-dialog';
import { canAct, displayName, payTermText, type ContactDetail } from './contact-types';

export function ContactDetailView({ id }: { id: number }) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const q = useQuery({ queryKey: ['contact', id], queryFn: () => api<ContactDetail>(`/contacts/${id}`) });

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong'));

  const toggle = useMutation({
    mutationFn: () => api(`/contacts/${id}/toggle-status`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('statusUpdated'));
      void qc.invalidateQueries({ queryKey: ['contact', id] });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(c('deleted'));
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      router.push(contact && contact.type === 'supplier' ? '/m/contacts/suppliers' : '/m/contacts/customers');
    },
    onError: (e) => {
      fail(e);
      setDeleting(false);
    },
  });

  const contact = q.data;

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-100" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }
  if (q.isError || !contact) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto max-w-5xl">
        <Card role="alert" className="text-center">
          <p className="text-sm text-red-700">{forbidden ? t('forbidden') : missing ? t('notFound') : c('loadError')}</p>
          <div className="mt-4 flex justify-center gap-2">
            {!forbidden && !missing && (
              <Button variant="outline" onClick={() => void q.refetch()}>
                {c('retry')}
              </Button>
            )}
            <Link href="/m/contacts" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-primary-dark hover:underline">
              {t('backToList')}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const unit = (k: 'days' | 'months') => t(k);
  const money = (v: string | null | undefined) => formatMoney(v ?? 0);
  const isSupplier = contact.type !== 'customer';
  const isCustomer = contact.type !== 'supplier';
  const canEdit = canAct(can, 'update', contact.type);
  const canDelete = canAct(can, 'delete', contact.type) && !contact.is_default;
  const address = [contact.address_line_1, contact.address_line_2, contact.city, contact.state, contact.country, contact.zip_code].filter(Boolean).join(', ');
  const extraAddress = [contact.land_mark, contact.street_name, contact.building_number, contact.additional_number].filter(Boolean).join(', ');
  const typeLabel = t(contact.type === 'supplier' ? 'typeSupplier' : contact.type === 'customer' ? 'typeCustomer' : 'typeBoth');
  const backHref = contact.type === 'supplier' ? '/m/contacts/suppliers' : '/m/contacts/customers';

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t('backToList')}
      </Link>
      <PageHeader
        title={displayName(contact)}
        description={[contact.contact_id, typeLabel].filter(Boolean).join(' - ')}
        actions={
          <>
            {canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                {c('edit')}
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={() => toggle.mutate()} disabled={toggle.isPending || (contact.is_default && contact.contact_status === 'active')}>
                <Power className="h-4 w-4" />
                {contact.contact_status === 'active' ? t('deactivate') : t('activate')}
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" onClick={() => setDeleting(true)} disabled={!contact.can_delete} title={contact.can_delete ? undefined : t('cannotDeleteHasTransactions')}>
                <Trash2 className="h-4 w-4 text-red-600" />
                {c('delete')}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={contact.contact_status === 'active' ? 'green' : 'red'}>{contact.contact_status === 'active' ? c('active') : c('inactive')}</Badge>
        {contact.is_default && <Badge tone="blue">{t('defaultBadge')}</Badge>}
        {contact.customer_group_name && <Badge tone="slate">{contact.customer_group_name}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('contactDetails')}</h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label={t('kindLabel')} value={contact.contact_type === 'business' ? t('kindBusiness') : t('kindIndividual')} />
            <Item label={t('businessName')} value={contact.supplier_business_name} />
            <Item label={t('mobile')} value={contact.mobile} />
            <Item label={t('alternateNumber')} value={contact.alternate_number} />
            <Item label={t('landline')} value={contact.landline} />
            <Item label={t('email')} value={contact.email} />
            <Item label={t('dob')} value={contact.dob ? contact.dob.slice(0, 10) : null} />
            <Item label={t('taxNumber')} value={contact.tax_number} />
            <Item label={t('payTerm')} value={payTermText(contact, unit)} />
            {isCustomer && <Item label={t('customerGroup')} value={contact.customer_group_name} />}
            <Item label={t('addressSection')} value={address} className="sm:col-span-2" />
            <Item label={t('addressExtra')} value={extraAddress} className="sm:col-span-2" />
            <Item label={t('shippingAddress')} value={contact.shipping_address} className="sm:col-span-2" />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('balanceSummary')}</h2>
          <dl className="space-y-3 text-sm">
            {isCustomer && <Amount label={t('customerOwes')} value={money(contact.customer_due)} alert={Number(contact.customer_due) > 0} />}
            {isSupplier && <Amount label={t('weOwe')} value={money(contact.supplier_due)} alert={Number(contact.supplier_due) > 0} />}
            <Amount label={t('openingBalanceOwed')} value={money(contact.opening_balance_due)} />
            <Amount label={t('advance')} value={money(contact.balance)} />
            {isCustomer && <Amount label={t('creditLimit')} value={contact.credit_limit != null ? money(contact.credit_limit) : t('noLimit')} />}
          </dl>
          <p className="mt-4 text-xs text-slate-500">{t('transactionCount', { count: contact.transaction_count })}</p>
        </Card>
      </div>

      {editing && <ContactDialog contact={contact} defaultSide={contact.type === 'supplier' ? 'supplier' : 'customer'} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        title={t('confirmDeleteTitle')}
        body={t('confirmDeleteBody', { name: displayName(contact) })}
      />
    </div>
  );
}

function Item({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{value ? value : '-'}</dd>
    </div>
  );
}

function Amount({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className={cn('font-semibold text-slate-900', alert && 'text-red-600')}>{value}</dd>
    </div>
  );
}
