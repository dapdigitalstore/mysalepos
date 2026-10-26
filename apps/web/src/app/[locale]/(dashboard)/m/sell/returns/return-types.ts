/** Shapes returned by the sell-returns API (money and quantities are decimal strings). */

export type PaymentStatus = 'paid' | 'partial' | 'due';

export interface ReturnRow {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  contactId: number | null;
  customerName: string | null;
  supplierBusinessName: string | null;
  mobile: string | null;
  locationId: number | null;
  locationName: string | null;
  parentSaleId: number | null;
  parentSaleInvoiceNo: string | null;
  totalBeforeTax: string;
  taxAmount: string;
  finalTotal: string;
  paymentStatus: PaymentStatus | null;
  amountPaid: string;
  paymentDue: string;
  createdBy: number;
  timeZone: string;
}

export interface ReturnList {
  data: ReturnRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
  totals: { finalTotal: string; amountPaid: string; paymentDue: string };
}

export interface SaleRow {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  customerName: string | null;
  supplierBusinessName: string | null;
  mobile: string | null;
  locationName: string | null;
  finalTotal: string;
  paymentStatus: PaymentStatus | null;
  returnId: number | null;
  returnInvoiceNo: string | null;
  returnTotal: string | null;
  timeZone: string;
}

export interface LookupLine {
  sellLineId: number;
  productId: number;
  variationId: number;
  productName: string;
  productType: string | null;
  variationName: string;
  sku: string;
  unitName: string;
  allowDecimal: boolean;
  multiplier: string;
  unitPriceIncTax: string;
  quantity: string;
  quantityReturned: string;
  returnable: string;
  enableStock: boolean;
}

export interface Lookup {
  sale: {
    id: number;
    invoiceNo: string | null;
    transactionDate: string;
    locationId: number | null;
    locationName: string | null;
    contactId: number | null;
    customerName: string | null;
    supplierBusinessName: string | null;
    mobile: string | null;
    totalBeforeTax: string;
    taxAmount: string;
    finalTotal: string;
    discountType: string | null;
    discountAmount: string;
    paymentStatus: PaymentStatus | null;
    taxId: number | null;
    taxName: string | null;
    taxRate: string;
  };
  existingReturn: {
    id: number;
    invoiceNo: string | null;
    transactionDate: string;
    discountType: string | null;
    discountAmount: string;
    totalBeforeTax: string;
    taxAmount: string;
    finalTotal: string;
    paymentStatus: PaymentStatus | null;
  } | null;
  form: {
    invoiceNo: string | null;
    transactionDate: string;
    discountType: string;
    discountAmount: string;
    taxId: number | null;
    taxName: string | null;
    taxRate: string;
  };
  lines: LookupLine[];
  timeZone: string;
}

export interface ReturnDetail {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  paymentStatus: PaymentStatus | null;
  totalBeforeTax: string;
  discountType: string | null;
  discountAmount: string;
  discount: string;
  taxId: number | null;
  taxName: string | null;
  taxRate: string;
  taxAmount: string;
  taxBreakdown: { id: number; name: string; rate: string; amount: string }[];
  finalTotal: string;
  amountPaid: string;
  paymentDue: string;
  business: { name: string };
  location: { id: number; name: string; address: string; mobile: string | null; email: string | null } | null;
  customer: { id: number; name: string | null; supplierBusinessName: string | null; mobile: string; address: string } | null;
  sale: { id: number; invoiceNo: string | null; transactionDate: string; finalTotal: string } | null;
  lines: {
    sellLineId: number;
    productName: string;
    variationName: string;
    sku: string;
    unitName: string;
    unitPriceIncTax: string;
    quantityReturned: string;
    lineTotal: string;
  }[];
  payments: { id: number; amount: string; method: string | null; paidOn: string | null; paymentRefNo: string | null; note: string | null; isReturn: boolean }[];
  timeZone: string;
}

export interface Option {
  id: number;
  label: string;
}

/** Date and time in the business time zone. */
export function formatDateTime(iso: string | null | undefined, timeZone: string, locale = 'en-GB'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export function formatDate(iso: string | null | undefined, timeZone: string, locale = 'en-GB'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Customer label like Laravel: business name first, then the person. */
export function customerLabel(r: { customerName: string | null; supplierBusinessName: string | null }): string {
  return [r.supplierBusinessName, r.customerName].filter((v): v is string => !!v && v.trim() !== '').join(', ');
}
