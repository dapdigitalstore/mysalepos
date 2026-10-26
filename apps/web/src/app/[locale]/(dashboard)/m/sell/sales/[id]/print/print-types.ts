import { formatMoney } from '@/lib/utils';
import type { SaleDetail } from '../../_lib/sale-types';

export type PrintFormat = 'receipt' | 'invoice';

/** Everything a print layout needs, gathered once by the loader (`sale-print.tsx`). */
export interface PrintData {
  sale: SaleDetail;
  businessName: string;
  /** Only an absolute URL / path is printed; a bare file name from the business record cannot be served yet. */
  logoUrl: string | null;
  locationName: string;
  address: string;
  phones: string[];
  email: string | null;
  website: string | null;
  taxNumbers: { label: string; value: string }[];
  dateTime: (iso: string | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  methodLabel: (key: string | null | undefined) => string;
}

export function isPrintable(logo: string | null): string | null {
  return logo && /^(https?:\/\/|\/)/.test(logo) ? logo : null;
}

/** Amount without the "Rs." prefix: used inside tight receipt columns. */
export function plainMoney(value: string | number): string {
  return formatMoney(value).replace(/^Rs\.\s*/, '');
}

export const nonZero = (v: string | number | null | undefined) => v !== null && v !== undefined && Number(v) !== 0;

/** Payments the customer made (not the change handed back) and the change itself. */
export function splitPayments(sale: SaleDetail) {
  return { paid: sale.payments.filter((p) => !p.isReturn), change: sale.payments.filter((p) => p.isReturn) };
}

export function documentTitleKey(sale: SaleDetail): 'titleInvoice' | 'titleQuotation' | 'titleProforma' | 'titleDraft' {
  if (sale.status === 'draft') return sale.subStatus === 'quotation' ? 'titleQuotation' : sale.subStatus === 'proforma' ? 'titleProforma' : 'titleDraft';
  return 'titleInvoice';
}
