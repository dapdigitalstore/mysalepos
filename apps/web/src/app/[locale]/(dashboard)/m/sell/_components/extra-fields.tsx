'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Field, Select, Textarea } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { SaleHeader } from '../_lib/cart';
import { saleApi } from '../_lib/sale-api';
import type { SaleSettings } from '../_lib/sale-types';

interface Props {
  settings: SaleSettings;
  header: SaleHeader;
  onHeader: (patch: Partial<SaleHeader>) => void;
  /** Id prefix so a dialog and a form on one page never share DOM ids. */
  idPrefix: string;
}

/** Notes, commission agent and the shipping details: the parts of a sale that are not about lines and money. */
export function ExtraFields({ settings, header, onHeader, idPrefix }: Props) {
  const t = useTranslations('pos');
  const canShip = settings.permissions.canShip;
  const users = useQuery({
    queryKey: ['sales', 'users-options'],
    queryFn: () => saleApi<{ id: number; label: string }[]>('/users/options'),
    enabled: canShip,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      {settings.commissionAgents.length > 0 && (
        <Field label={t('commissionAgent')} htmlFor={`${idPrefix}-agent`}>
          <Select id={`${idPrefix}-agent`} value={header.commissionAgentId ?? ''} onChange={(e) => onHeader({ commissionAgentId: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('none')}</option>
            {settings.commissionAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('saleNote')} htmlFor={`${idPrefix}-sale-note`} hint={t('saleNoteHint')}>
          <Textarea id={`${idPrefix}-sale-note`} value={header.saleNote} onChange={(e) => onHeader({ saleNote: e.target.value })} maxLength={5000} />
        </Field>
        <Field label={t('staffNote')} htmlFor={`${idPrefix}-staff-note`} hint={t('staffNoteHint')}>
          <Textarea id={`${idPrefix}-staff-note`} value={header.staffNote} onChange={(e) => onHeader({ staffNote: e.target.value })} maxLength={5000} />
        </Field>
      </div>

      {canShip && (
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">{t('shipping')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('shippingDetails')} htmlFor={`${idPrefix}-ship-details`}>
              <Textarea id={`${idPrefix}-ship-details`} value={header.shippingDetails} onChange={(e) => onHeader({ shippingDetails: e.target.value })} maxLength={5000} />
            </Field>
            <Field label={t('shippingAddress')} htmlFor={`${idPrefix}-ship-address`}>
              <Textarea id={`${idPrefix}-ship-address`} value={header.shippingAddress} onChange={(e) => onHeader({ shippingAddress: e.target.value })} maxLength={5000} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('shippingStatus')} htmlFor={`${idPrefix}-ship-status`}>
              <Select id={`${idPrefix}-ship-status`} value={header.shippingStatus} onChange={(e) => onHeader({ shippingStatus: e.target.value })}>
                <option value="">{t('none')}</option>
                {settings.shippingStatuses.map((s) => (
                  <option key={s} value={s}>
                    {t(`shippingStatuses.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('deliveredTo')} htmlFor={`${idPrefix}-delivered-to`}>
              <Input id={`${idPrefix}-delivered-to`} value={header.deliveredTo} onChange={(e) => onHeader({ deliveredTo: e.target.value })} maxLength={191} autoComplete="off" />
            </Field>
            <Field label={t('deliveryPerson')} htmlFor={`${idPrefix}-delivery-person`}>
              <Select id={`${idPrefix}-delivery-person`} value={header.deliveryPerson ?? ''} onChange={(e) => onHeader({ deliveryPerson: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">{t('none')}</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
      )}
    </div>
  );
}
