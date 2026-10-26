'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { api } from '@/lib/client-api';
import { FALLBACK_TIME_ZONE, formatDate, formatDateTime } from './format';
import type { MeBusiness, Option, PosSettingsLite } from './sale-types';

/** Business name, logo and time zone from /auth/me (open to every signed-in user). */
export function useBusiness() {
  const q = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<{ business: MeBusiness | null }>('/auth/me'),
    staleTime: 10 * 60_000,
  });
  const business = q.data?.business ?? null;
  return {
    name: business?.name ?? '',
    logo: business?.logo ?? null,
    timeZone: business?.time_zone || FALLBACK_TIME_ZONE,
    /** false until the time zone is known: lists wait for it so dates never flash in the wrong zone. */
    ready: q.isSuccess || q.isError,
  };
}

/** Formatters bound to the business time zone and the current UI language. */
export function useDateFormat() {
  const locale = useLocale();
  const { timeZone, ready } = useBusiness();
  return {
    ready,
    timeZone,
    dateTime: (value: string | null | undefined) => formatDateTime(value, timeZone, locale),
    date: (value: string | null | undefined) => formatDate(value, timeZone, locale),
  };
}

/** Payment methods, accounts and agent mode of the business. Needs a sell permission; callers must cope with `undefined`. */
export function usePosSettings(enabled = true) {
  return useQuery({
    queryKey: ['sales', 'pos-settings', 'lite'],
    queryFn: () => api<PosSettingsLite>('/sales/pos-settings'),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function useLocationOptions() {
  return useQuery({ queryKey: ['business-locations', 'options'], queryFn: () => api<Option[]>('/business-locations/options') });
}

export function useCustomerOptions() {
  return useQuery({
    queryKey: ['contacts', 'options', 'customer'],
    queryFn: () => api<Option[]>('/contacts/options', { query: { type: 'customer', limit: 500 } }),
  });
}

export function useUserOptions() {
  return useQuery({ queryKey: ['users', 'options'], queryFn: () => api<Option[]>('/users/options') });
}

export function useCommissionAgentOptions(enabled: boolean) {
  return useQuery({ queryKey: ['commission-agents', 'options'], queryFn: () => api<Option[]>('/commission-agents/options'), enabled });
}
