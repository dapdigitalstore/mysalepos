'use client';

import { useQuery } from '@tanstack/react-query';
import { saleApi } from '../_lib/sale-api';
import type { SaleSettings } from '../_lib/sale-types';

/** Query keys of the sale screens. */
export const SALE_KEYS = {
  settings: ['sales', 'pos-settings'] as const,
  recent: ['sales', 'recent'] as const,
  suspended: ['sales', 'suspended'] as const,
  customers: ['sales', 'customers'] as const,
};

/** GET /sales/pos-settings: everything a sale screen needs at start (docs/SALES-API.md 4.1). */
export function useSaleSettings() {
  return useQuery({
    queryKey: SALE_KEYS.settings,
    queryFn: () => saleApi<SaleSettings>('/sales/pos-settings'),
    staleTime: 60_000,
  });
}

/** A POS flag stored by Laravel is 1 / "1" / true. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === '1';
