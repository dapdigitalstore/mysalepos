/** Shapes returned by the sales API (docs/SALES-API.md). Money and quantities are decimal strings. */

export type PaymentStatus = 'paid' | 'due' | 'partial';
export type DisplayPaymentStatus = PaymentStatus | 'overdue' | 'partial-overdue';
export type SaleStatus = 'final' | 'draft';

export interface SaleListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** One row of GET /sales, /sales/drafts and /sales/quotations. */
export interface SaleRow {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  status: string;
  subStatus: string | null;
  paymentStatus: PaymentStatus | null;
  displayPaymentStatus: DisplayPaymentStatus | null;
  finalTotal: string;
  totalBeforeTax: string;
  taxAmount: string;
  discountType: string | null;
  discountAmount: string;
  shippingStatus: string | null;
  shippingCharges: string;
  isDirectSale: boolean;
  isSuspend: boolean;
  locationId: number | null;
  locationName: string | null;
  contactId: number | null;
  contactName: string | null;
  supplierBusinessName: string | null;
  contactMobile: string | null;
  contactCode: string | null;
  createdBy: number;
  addedBy: string | null;
  commissionAgent: string | null;
  saleNote: string | null;
  staffNote: string | null;
  totalPaid: string;
  totalRemaining: string;
  totalItems: string;
  hasReturn: boolean;
  returnTotal: string;
  returnDue: string;
}

export interface SaleList {
  data: SaleRow[];
  meta: SaleListMeta & { totals: { finalTotal: string; totalPaid: string; totalRemaining: string } };
}

export interface DraftList {
  data: SaleRow[];
  meta: SaleListMeta;
}

export interface Unit {
  id: number;
  shortName: string;
  allowDecimal: boolean;
}

export interface SaleLine {
  id: number;
  parentSellLineId: number | null;
  childrenType: '' | 'combo';
  productId: number;
  variationId: number;
  productName: string;
  variationName: string | null;
  productType: string;
  sku: string | null;
  subSku: string | null;
  label: string;
  enableStock: boolean;
  unit: Unit | null;
  subUnitId: number | null;
  subUnitName: string | null;
  multiplier: string;
  quantity: string;
  baseQuantity: string;
  unitPriceBeforeDiscount: string;
  unitPrice: string;
  lineDiscountType: string | null;
  lineDiscountAmount: string;
  taxId: number | null;
  taxRate: string;
  itemTax: string;
  unitPriceIncTax: string;
  lineTotal: string;
  sellLineNote: string | null;
  quantityReturned: string;
}

export interface SalePayment {
  id: number;
  method: string | null;
  amount: string;
  isReturn: boolean;
  paidOn: string | null;
  paymentRefNo: string | null;
  note: string | null;
  cardTransactionNumber: string | null;
  cardNumber: string | null;
  cardType: string | null;
  cardHolderName: string | null;
  cardMonth: string | null;
  cardYear: string | null;
  chequeNumber: string | null;
  bankAccountNumber: string | null;
  transactionNo: string | null;
  accountId: number | null;
}

export interface SaleCustomer {
  id: number;
  name: string | null;
  supplierBusinessName: string | null;
  mobile: string | null;
  contactCode: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  isDefault: boolean;
  balance: string;
  totalRp: number | string | null;
  creditLimit: string | null;
}

export interface SaleTotals {
  subTotal: string;
  totalBeforeTax: string;
  discountType: string | null;
  discountAmount: string;
  discountValue: string;
  rpRedeemed: number | string | null;
  rpRedeemedAmount: string;
  orderTaxId: number | null;
  orderTaxName: string | null;
  orderTaxRate: string;
  taxAmount: string;
  shippingCharges: string;
  packingCharge: string;
  packingChargeType: string | null;
  additionalExpenses: { key: string; value: string }[];
  roundOffAmount: string;
  finalTotal: string;
  totalPaid: string;
  totalDue: string;
  rpEarned: number | string | null;
}

export interface SaleDetail {
  id: number;
  invoiceNo: string | null;
  type: string;
  status: string;
  subStatus: string | null;
  isQuotation: boolean;
  isDirectSale: boolean;
  isSuspend: boolean;
  paymentStatus: PaymentStatus | null;
  displayPaymentStatus: DisplayPaymentStatus | null;
  transactionDate: string;
  locationId: number;
  location: { id: number; name: string } | null;
  contactId: number;
  customer: SaleCustomer | null;
  createdBy: number;
  addedBy: string | null;
  commissionAgentId: number | null;
  payTermNumber: number | null;
  payTermType: string | null;
  lines: SaleLine[];
  payments: SalePayment[];
  totals: SaleTotals;
  shipping: {
    details: string | null;
    address: string | null;
    status: string | null;
    deliveredTo: string | null;
    deliveryPerson: string | number | null;
    customFields: (string | null)[];
  };
  saleNote: string | null;
  staffNote: string | null;
  exchangeRate: string;
  returns: { id: number; invoiceNo: string | null; finalTotal: string; transactionDate: string }[];
}

export interface PaymentsBody {
  saleId: number;
  finalTotal: string;
  totalPaid: string;
  due: string;
  paymentStatus: PaymentStatus | null;
  payments: SalePayment[];
}

export interface PaymentDefaults {
  saleId: number;
  invoiceNo: string | null;
  status: 'due' | 'closed';
  finalTotal: string;
  totalPaid: string;
  amount: string;
  method: string;
  paidOn: string;
}

export interface Option {
  id: number;
  label: string;
}

export interface MeBusiness {
  id: number;
  name: string;
  logo: string | null;
  time_zone: string;
}

export interface PosSettingsLite {
  business: { name: string; timeZone: string; salesCmsnAgnt: string | null; currencyPrecision: number; quantityPrecision: number };
  posSettings: Record<string, unknown>;
  paymentMethods: { key: string; label: string }[];
  accounts?: { id: number; name: string }[];
}

export const SHIPPING_STATUSES = ['ordered', 'packed', 'shipped', 'delivered', 'cancelled'] as const;
export const BASE_PAYMENT_METHODS = ['cash', 'card', 'cheque', 'bank_transfer', 'other'] as const;

/** Customer label like Laravel: business name first, then the person. */
export function customerLabel(r: { contactName: string | null; supplierBusinessName: string | null }): string {
  return [r.supplierBusinessName, r.contactName].filter((v): v is string => !!v && v.trim() !== '').join(', ');
}

/** Same for the customer object of the sale detail. */
export function detailCustomerLabel(c: { name: string | null; supplierBusinessName: string | null } | null): string {
  if (!c) return '';
  return customerLabel({ contactName: c.name, supplierBusinessName: c.supplierBusinessName });
}
