/** Shapes of the sales API used by the POS and the add / edit sale screens (docs/SALES-API.md). Money is a decimal string. */

export type SaleStatusInput = 'final' | 'draft' | 'quotation' | 'proforma';
export type DiscountKind = 'fixed' | 'percentage';

export interface PaymentMethodOption {
  key: string;
  label: string;
  accountId?: number | null;
}

export interface SaleLocation {
  id: number;
  name: string;
  invoiceSchemeId: number | null;
  saleInvoiceSchemeId: number | null;
  sellingPriceGroupId: number | null;
  printReceiptOnInvoice: boolean;
  receiptPrinterType: string | null;
  paymentMethods: PaymentMethodOption[];
}

export interface TaxRateOption {
  id: number;
  name: string;
  rate: string;
  isTaxGroup: boolean;
}

export interface SaleSettings {
  business: {
    id: number;
    name: string;
    timeZone: string;
    currencyPrecision: number;
    quantityPrecision: number;
    enableInlineTax: boolean;
    itemAdditionMethod: number | null;
    enableSubUnits: boolean;
    enableLotNumber: boolean;
    defaultSalesTaxId: number | null;
    defaultSalesDiscount: string | null;
    transactionEditDays: number | null;
    enabledModules: string[];
    rewardPoints: { enabled: boolean };
  };
  posSettings: {
    disable_pay_checkout?: unknown;
    disable_draft?: unknown;
    disable_express_checkout?: unknown;
    hide_product_suggestion?: unknown;
    hide_recent_trans?: unknown;
    disable_discount?: unknown;
    disable_order_tax?: unknown;
    is_pos_subtotal_editable?: unknown;
    enable_transaction_date?: unknown;
    allow_overselling?: boolean;
    amount_rounding_method?: string | null;
    [key: string]: unknown;
  };
  keyboardShortcuts: { pos?: Record<string, string> } | null;
  permissions: {
    canSell: boolean;
    canDirectSell: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canTakePayments: boolean;
    canDiscount: boolean;
    canShip: boolean;
    canPrint: boolean;
    canListDrafts: boolean;
    canListQuotations: boolean;
    canViewRegister: boolean;
    canCloseRegister: boolean;
    canEditPrice: { pos: boolean; direct: boolean };
    canEditLineDiscount: { pos: boolean; direct: boolean };
    canSeeDefaultSellingPrice: boolean;
  };
  locations: SaleLocation[];
  defaultLocationId: number | null;
  paymentMethods: PaymentMethodOption[];
  taxRates: TaxRateOption[];
  sellingPriceGroups: { id: number; name: string }[];
  invoiceSchemes: { id: number; name: string; isDefault: boolean }[];
  walkInCustomer: { id: number; name: string; mobile: string | null; creditLimit: string | null } | null;
  accounts: { id: number; name: string }[];
  commissionAgents: { id: number; name: string }[];
  shippingStatuses: string[];
}

export interface UnitInfo {
  id: number;
  shortName: string;
  allowDecimal: boolean;
}

export interface SubUnitInfo {
  id: number;
  name: string;
  multiplier: string;
  allowDecimal: boolean;
}

export interface LotInfo {
  purchaseLineId: number;
  lotNumber: string | null;
  expDate: string | null;
  qtyAvailable: string;
}

export interface ProductRow {
  productId: number;
  variationId: number;
  productName: string;
  variationName: string | null;
  label: string;
  sku: string;
  subSku: string | null;
  productType: string;
  enableStock: boolean;
  qtyAvailable: string | null;
  unit: UnitInfo;
  subUnits: SubUnitInfo[];
  taxId: number | null;
  taxRate: string;
  unitPrice: string;
  quantity: string;
  lineDiscountType: DiscountKind;
  lineDiscountAmount: string;
  customerGroupId: number | null;
  appliedPriceGroupId: number | null;
  lots: LotInfo[];
  canEditPrice: boolean;
  canEditDiscount: boolean;
}

/** One hit of GET /products/search (a variation). The API returns snake_case here. */
export interface ProductHit {
  product_id: number;
  variation_id: number;
  name: string;
  variation: string | null;
  type: string;
  sku: string;
  sub_sku: string | null;
  unit: string | null;
  enable_stock: boolean;
  qty_available: string | null;
  selling_price: string;
  group_price: string | null;
  label: string;
}

export interface CustomerOption {
  id: number;
  label: string;
  mobile: string | null;
  customerGroupId: number | null;
  isDefault: boolean;
  payTermNumber: number | null;
  payTermType: string | null;
  /** Advance balance the customer holds (the `advance` payment method spends it). */
  balance: string | null;
  creditLimit: string | null;
}

export interface SaleLineDetail {
  id: number;
  parentSellLineId: number | null;
  childrenType: string;
  productId: number;
  variationId: number;
  productName: string;
  variationName: string | null;
  productType: string;
  sku: string;
  subSku: string | null;
  label: string;
  enableStock: boolean;
  unit: UnitInfo;
  subUnitId: number | null;
  subUnitName: string | null;
  subUnits: SubUnitInfo[];
  multiplier: string;
  quantity: string;
  baseQuantity: string;
  unitPriceBeforeDiscount: string;
  unitPrice: string;
  lineDiscountType: DiscountKind | null;
  lineDiscountAmount: string;
  taxId: number | null;
  taxRate: string;
  itemTax: string;
  unitPriceIncTax: string;
  lineTotal: string;
  sellLineNote: string | null;
  lotNoLineId: number | null;
  secondaryUnitQuantity: string | null;
  quantityReturned: string;
  resServiceStaffId: number | null;
  qtyAvailable: string | null;
}

export interface SalePaymentDetail {
  id: number;
  method: string;
  amount: string;
  isReturn: boolean;
  paidOn: string;
  paymentRefNo: string | null;
  note: string | null;
  cardTransactionNumber: string | null;
  cardNumber: string | null;
  cardType: string | null;
  cardHolderName: string | null;
  chequeNumber: string | null;
  bankAccountNumber: string | null;
  transactionNo: string | null;
  accountId: number | null;
}

export interface SaleDetail {
  id: number;
  invoiceNo: string | null;
  type: string;
  status: 'final' | 'draft';
  subStatus: 'quotation' | 'proforma' | null;
  isQuotation: boolean;
  isDirectSale: boolean;
  isSuspend: boolean;
  paymentStatus: string | null;
  transactionDate: string;
  locationId: number;
  location: { id: number; name: string } | null;
  contactId: number;
  customer: {
    id: number;
    name: string;
    supplierBusinessName: string | null;
    mobile: string | null;
    contactCode: string | null;
    isDefault: boolean;
    balance: string | null;
    creditLimit: string | null;
  } | null;
  customerGroupId: number | null;
  sellingPriceGroupId: number | null;
  commissionAgentId: number | null;
  payTermNumber: number | null;
  payTermType: string | null;
  lines: SaleLineDetail[];
  payments: SalePaymentDetail[];
  totals: {
    discountType: DiscountKind | null;
    discountAmount: string;
    orderTaxId: number | null;
    shippingCharges: string;
    additionalExpenses: { key: string; value: string }[];
    finalTotal: string;
    totalPaid: string;
    totalDue: string;
  };
  shipping: {
    details: string | null;
    address: string | null;
    status: string | null;
    deliveredTo: string | null;
    deliveryPerson: number | null;
    customFields: (string | null)[];
  };
  saleNote: string | null;
  staffNote: string | null;
  returns: { id: number; invoiceNo: string | null; finalTotal: string }[];
}

export interface RecentSale {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  status: string;
  subStatus: string | null;
  paymentStatus: string | null;
  isSuspend: boolean;
  finalTotal: string;
  contactId: number | null;
  contactName: string | null;
}

export interface SaleListRow {
  id: number;
  invoiceNo: string | null;
  transactionDate: string;
  finalTotal: string;
  contactName: string | null;
  contactMobile: string | null;
  totalItems: number | string | null;
  locationName: string | null;
}

export interface SaleListResponse {
  data: SaleListRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

/** Request body of POST /sales and PUT /sales/:id. Only documented fields. */
export interface SaleLineBody {
  id?: number;
  productId: number;
  variationId: number;
  quantity: string;
  unitPrice: string;
  lineDiscountType?: DiscountKind;
  lineDiscountAmount?: string;
  taxId?: number | null;
  subUnitId?: number | null;
  sellLineNote?: string | null;
  lotNoLineId?: number | null;
}

export interface SalePaymentBody {
  id?: number;
  method: string;
  amount: string;
  note?: string | null;
  cardTransactionNumber?: string | null;
  cardNumber?: string | null;
  cardType?: string | null;
  cardHolderName?: string | null;
  chequeNumber?: string | null;
  bankAccountNumber?: string | null;
  transactionNo?: string | null;
  accountId?: number | null;
}

export interface SaleBody {
  status: SaleStatusInput;
  isDirectSale?: boolean;
  isSuspend?: boolean;
  isCreditSale?: boolean;
  locationId: number;
  contactId: number;
  transactionDate?: string;
  invoiceSchemeId?: number | null;
  invoiceNo?: string | null;
  sellingPriceGroupId?: number | null;
  commissionAgentId?: number | null;
  payTermNumber?: number | null;
  payTermType?: 'days' | 'months' | null;
  lines: SaleLineBody[];
  discountType?: DiscountKind | null;
  discountAmount?: string | null;
  taxRateId?: number | null;
  shippingCharges?: string | null;
  shippingDetails?: string | null;
  shippingAddress?: string | null;
  shippingStatus?: string | null;
  deliveredTo?: string | null;
  deliveryPerson?: number | null;
  additionalExpenses?: { key: string; value: string }[];
  saleNote?: string | null;
  staffNote?: string | null;
  payments?: SalePaymentBody[];
  changeReturn?: string | null;
  changeReturnPaymentId?: number | null;
}
