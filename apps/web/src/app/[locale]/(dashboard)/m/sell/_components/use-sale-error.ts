'use client';

import { useTranslations } from 'next-intl';
import { SaleApiError } from '../_lib/sale-api';

/** Codes whose server message names the thing that failed (the product, the limit) and is worth showing next to ours. */
const WITH_DETAIL = new Set(['CREDIT_LIMIT_EXCEEDED', 'PURCHASE_SELL_MISMATCH']);

/**
 * Turns an API failure into one readable sentence: our translation of the `code` (docs/SALES-API.md section 8) when we have one,
 * otherwise the server's own message.
 */
export function useSaleError() {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  return (e: unknown): string => {
    if (e instanceof SaleApiError) {
      const server = e.messages[0];
      if (e.code && t.has(`errors.${e.code}`)) {
        const own = t(`errors.${e.code}`);
        return WITH_DETAIL.has(e.code) && server ? `${own} (${server})` : own;
      }
      if (e.status === 403 && !server) return t('errors.forbidden');
      return server ?? c('somethingWrong');
    }
    return c('somethingWrong');
  };
}

/** True when the sale failed because the user has no open cash register. */
export const isRegisterError = (e: unknown): boolean => e instanceof SaleApiError && e.code === 'REGISTER_NOT_OPEN';
