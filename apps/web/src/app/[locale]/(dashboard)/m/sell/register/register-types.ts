/** Shapes of the /cash-registers API (apps/api/src/modules/cash-register). Money is always a decimal string. */

export type PaymentMethodKey =
  | 'cash'
  | 'card'
  | 'cheque'
  | 'bank_transfer'
  | 'other'
  | 'advance'
  | 'custom_pay_1'
  | 'custom_pay_2'
  | 'custom_pay_3'
  | 'custom_pay_4'
  | 'custom_pay_5'
  | 'custom_pay_6'
  | 'custom_pay_7';

export interface CurrentRegister {
  id: number;
  locationId: number | null;
  locationName: string | null;
  openedAt: string;
  cashInHand: string;
}

export interface CurrentRegisterResponse {
  open: boolean;
  register: CurrentRegister | null;
  timeZone?: string;
}

export interface PaymentTypeInfo {
  method: PaymentMethodKey;
  label: string | null;
}

export interface MethodTotals {
  method: PaymentMethodKey;
  sale: string;
  expense: string;
  refund: string;
}

export interface DenominationRow {
  denomination: string;
  count: number;
  subtotal: string;
}

export interface ProductLine {
  sku: string | null;
  productName: string;
  productType: string;
  variationName: string | null;
  productVariationName: string | null;
  quantity: string;
  amount: string;
}

export interface BrandLine {
  brandName: string | null;
  quantity: string;
  amount: string;
}

export interface RegisterDetails {
  register: {
    id: number;
    status: 'open' | 'close';
    openedAt: string;
    closedAt: string | null;
    userId: number | null;
    userName: string;
    email: string | null;
    locationId: number | null;
    locationName: string | null;
    closingAmount: string;
    totalCardSlips: number;
    totalCheques: number;
    closingNote: string | null;
    denominations: DenominationRow[];
    denominationsTotal: string;
  };
  closeTime: string;
  timeZone: string;
  paymentTypes: PaymentTypeInfo[];
  totals: {
    cashInHand: string;
    totalSale: string;
    totalExpense: string;
    totalRefund: string;
    totalPayment: string;
    grossSale: string;
    expectedTotal: string;
    suggestedClosingAmount: string;
    cardSlips: number;
    cheques: number;
    creditSales: string;
    shiftSales: string;
    methods: MethodTotals[];
  };
  shift: {
    totalTax: string;
    totalDiscount: string;
    totalShippingCharges: string;
    products: ProductLine[];
    productsQuantity: string;
    productsGrandTotal: string;
    brands: BrandLine[];
    brandsQuantity: string;
    brandsGrandTotal: string;
    typesOfService: { name: string | null; total: string }[] | null;
  };
  config: { denominations: string[]; denominationsOn: string | null };
}

export interface RegisterReportRow {
  id: number;
  status: 'open' | 'close';
  openedAt: string;
  closedAt: string | null;
  userId: number | null;
  userName: string;
  email: string | null;
  locationId: number | null;
  locationName: string | null;
  closingAmount: string;
  totalCardSlips: number;
  totalCheques: number;
  methods: Record<PaymentMethodKey, string>;
  total: string;
}

export interface RegisterReportResponse {
  data: RegisterReportRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
  totals: { methods: Record<PaymentMethodKey, string>; total: string };
  timeZone: string;
}

export interface Option {
  id: number;
  label: string;
}

/** Query keys shared so a mutation in one screen refreshes the others. */
export const REGISTER_KEYS = {
  current: ['cash-register', 'current'] as const,
  details: ['cash-register', 'details'] as const,
  report: ['cash-register', 'report'] as const,
};
