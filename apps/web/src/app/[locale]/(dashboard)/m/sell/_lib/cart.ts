/**
 * The cart of a sale screen: line model, line rules checked while typing, and the request body for POST/PUT /sales.
 * Pure functions (no React). Maths comes from ./sale-math; the server recomputes everything on save.
 */
import { add, cmp, decimalsOf, dec, isNeg, isPos, isWhole, isZero, mul, mulDiv, ONE, parseDec, sub, toText, ZERO, type Dec } from './decimal';
import { calcInvoice, calcLine, type InvoiceMath, type LineMath } from './sale-math';
import type {
  CustomerOption,
  DiscountKind,
  LotInfo,
  ProductRow,
  SaleBody,
  SaleDetail,
  SaleLineBody,
  SaleLineDetail,
  SalePaymentBody,
  SalePaymentDetail,
  SaleSettings,
  SaleStatusInput,
  SubUnitInfo,
  TaxRateOption,
  UnitInfo,
} from './sale-types';
import { instantToLocalInput, localInputToInstant } from './time';

// ------------------------------------------------------------------------------------------------ lines

export interface CartLine {
  /** Client side id (React key). */
  key: string;
  /** Existing sell line (edit); undefined for a new line. */
  id?: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  productType: string;
  enableStock: boolean;
  /** Stock at the location in the product's own unit. */
  qtyAvailable: string | null;
  /** Base-unit quantity this sale already holds (editing a final sale), added to the available stock. */
  heldQty: string;
  unit: UnitInfo;
  subUnits: SubUnitInfo[];
  subUnitId: number | null;
  quantity: string;
  /** Price excluding tax before the discount, per the unit being sold. */
  unitPrice: string;
  /** Catalogue price per BASE unit (excluding tax) when known; lets the sub-unit switch stay exact. */
  basePrice: string | null;
  priceEdited: boolean;
  discountType: DiscountKind;
  discountAmount: string;
  taxId: number | null;
  note: string;
  lotNoLineId: number | null;
  lots: LotInfo[];
  canEditPrice: boolean;
  canEditDiscount: boolean;
}

let keyCounter = 0;
export const newKey = (): string => `k${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

export const multiplierOf = (line: Pick<CartLine, 'subUnitId' | 'subUnits'>): Dec => {
  if (line.subUnitId === null) return ONE;
  const unit = line.subUnits.find((s) => s.id === line.subUnitId);
  const m = dec(unit?.multiplier);
  return isPos(m) ? m : ONE;
};

export const allowsDecimal = (line: Pick<CartLine, 'subUnitId' | 'subUnits' | 'unit'>): boolean => {
  if (line.subUnitId !== null) {
    const s = line.subUnits.find((u) => u.id === line.subUnitId);
    if (s) return s.allowDecimal;
  }
  return line.unit.allowDecimal;
};

export const lineName = (productName: string, variationName: string | null): string =>
  variationName && variationName.trim() && variationName.trim().toUpperCase() !== 'DUMMY' ? `${productName} - ${variationName}` : productName;

export function lineFromRow(row: ProductRow, opts: { quantity?: string; canEditPrice: boolean; canEditDiscount: boolean; inlineTax: boolean }): CartLine {
  return {
    key: newKey(),
    productId: row.productId,
    variationId: row.variationId,
    name: lineName(row.productName, row.variationName),
    sku: row.subSku ?? row.sku,
    productType: row.productType,
    enableStock: row.enableStock,
    qtyAvailable: row.qtyAvailable,
    heldQty: '0',
    unit: row.unit,
    subUnits: row.subUnits,
    subUnitId: null,
    quantity: opts.quantity ?? row.quantity ?? '1',
    unitPrice: row.unitPrice,
    basePrice: row.unitPrice,
    priceEdited: false,
    discountType: row.lineDiscountType ?? 'fixed',
    discountAmount: row.lineDiscountAmount ?? '0',
    taxId: opts.inlineTax ? row.taxId : null,
    note: '',
    lotNoLineId: null,
    lots: row.lots ?? [],
    canEditPrice: row.canEditPrice && opts.canEditPrice,
    canEditDiscount: row.canEditDiscount && opts.canEditDiscount,
  };
}

/** A stored sale line loaded into the edit form (combo component lines are skipped by the caller). */
export function lineFromSaleLine(l: SaleLineDetail, opts: { canEditPrice: boolean; canEditDiscount: boolean; inlineTax: boolean; heldBase: boolean }): CartLine {
  return {
    key: newKey(),
    id: l.id,
    productId: l.productId,
    variationId: l.variationId,
    name: lineName(l.productName, l.variationName),
    sku: l.subSku ?? l.sku,
    productType: l.productType,
    enableStock: l.enableStock,
    qtyAvailable: l.qtyAvailable,
    heldQty: opts.heldBase ? l.baseQuantity : '0',
    unit: l.unit,
    subUnits: l.subUnits,
    subUnitId: l.subUnitId,
    quantity: l.quantity,
    unitPrice: l.unitPriceBeforeDiscount,
    basePrice: null,
    priceEdited: true,
    discountType: l.lineDiscountType ?? 'fixed',
    discountAmount: l.lineDiscountAmount ?? '0',
    taxId: opts.inlineTax ? l.taxId : null,
    note: l.sellLineNote ?? '',
    lotNoLineId: l.lotNoLineId,
    lots: [],
    canEditPrice: opts.canEditPrice,
    canEditDiscount: opts.canEditDiscount,
  };
}

export const taxRateOf = (taxId: number | null, taxRates: TaxRateOption[]): string => {
  if (taxId === null) return '0';
  return taxRates.find((t) => t.id === taxId)?.rate ?? '0';
};

export function calcCartLine(line: CartLine, taxRates: TaxRateOption[], currencyPrecision: number): LineMath {
  return calcLine(
    { quantity: line.quantity, unitPrice: line.unitPrice, discountType: line.discountType, discountAmount: line.discountAmount, taxRate: taxRateOf(line.taxId, taxRates) },
    currencyPrecision,
  );
}

/** Switch the unit of a line: price (and a fixed discount) move with the multiplier, the typed quantity stays (as in Laravel). */
export function withSubUnit(line: CartLine, subUnitId: number | null): CartLine {
  if (line.subUnitId === subUnitId) return line;
  const oldM = multiplierOf(line);
  const next: CartLine = { ...line, subUnitId };
  const newM = multiplierOf(next);
  next.unitPrice =
    !line.priceEdited && line.basePrice !== null ? toText(mul(dec(line.basePrice), newM)) : toText(mulDiv(dec(line.unitPrice), newM, oldM, 4));
  if (line.discountType === 'fixed' && !isZero(dec(line.discountAmount))) next.discountAmount = toText(mulDiv(dec(line.discountAmount), newM, oldM, 4));
  return next;
}

/** Stock available in the unit being sold (own stock plus what this sale already holds), null when untracked or unknown. */
export function availableIn(line: CartLine): Dec | null {
  if (!line.enableStock || line.qtyAvailable === null) return null;
  const base = dec(line.qtyAvailable);
  const held = dec(line.heldQty);
  return mulDiv(add(base, held), ONE, multiplierOf(line), 4);
}

export type LineIssue = 'quantity' | 'decimal' | 'price' | 'discount' | 'stock';

/** What is wrong with a line right now (empty = fine). `checkStock` is false for drafts and quotations. */
export function lineIssues(line: CartLine, opts: { checkStock: boolean; allowOverselling: boolean }): LineIssue[] {
  const issues: LineIssue[] = [];
  const q = parseDec(line.quantity);
  if (!q || !isPos(q) || decimalsOf(q) > 4) issues.push('quantity');
  else if (!allowsDecimal(line) && !isWhole(q)) issues.push('decimal');
  const p = parseDec(line.unitPrice);
  if (!p || isNeg(p)) issues.push('price');
  const d = parseDec(line.discountAmount === '' ? '0' : line.discountAmount);
  if (!d || isNeg(d) || (line.discountType === 'percentage' && cmp(d, { n: 100n, s: 0 }) > 0)) issues.push('discount');
  if (opts.checkStock && !opts.allowOverselling && q && isPos(q)) {
    const avail = availableIn(line);
    if (avail !== null && cmp(q, avail) > 0) issues.push('stock');
  }
  return issues;
}

/** Adds a freshly loaded row to the cart. With "increase quantity" addition (default) an existing line of the same variation is incremented. */
export function mergeIntoCart(lines: CartLine[], incoming: CartLine, increaseExisting: boolean): CartLine[] {
  if (increaseExisting) {
    const idx = lines.findIndex((l) => l.variationId === incoming.variationId && l.subUnitId === null && l.lotNoLineId === null);
    if (idx >= 0) {
      return lines.map((l, i) => (i === idx ? { ...l, quantity: toText(add(dec(l.quantity), dec(incoming.quantity))) } : l));
    }
  }
  return [...lines, incoming];
}

/** Laravel `item_addition_method`: 1 = increase the quantity of a product already in the cart (the default). */
export const increasesExisting = (settings: SaleSettings): boolean => settings.business.itemAdditionMethod !== 0;

// ------------------------------------------------------------------------------------------------ header

export interface SaleHeader {
  locationId: number | null;
  customer: CustomerOption | null;
  priceGroupId: number | null;
  discountType: DiscountKind;
  discountAmount: string;
  taxRateId: number | null;
  shippingCharges: string;
  shippingDetails: string;
  shippingAddress: string;
  shippingStatus: string;
  deliveredTo: string;
  deliveryPerson: number | null;
  additionalExpenses: { key: string; value: string }[];
  saleNote: string;
  staffNote: string;
  commissionAgentId: number | null;
  payTermNumber: string;
  payTermType: '' | 'days' | 'months';
  /** `YYYY-MM-DDTHH:mm` in the business time zone (add / edit sale screen only). */
  transactionDate: string;
  invoiceNo: string;
  invoiceSchemeId: number | null;
  status: SaleStatusInput;
}

export const emptyExpenses = (): { key: string; value: string }[] => [0, 1, 2, 3].map(() => ({ key: '', value: '' }));

export function walkInOption(settings: SaleSettings): CustomerOption | null {
  const w = settings.walkInCustomer;
  if (!w) return null;
  return { id: w.id, label: w.name, mobile: w.mobile, customerGroupId: null, isDefault: true, payTermNumber: null, payTermType: null, balance: null, creditLimit: w.creditLimit };
}

export function defaultHeader(settings: SaleSettings, forPos: boolean): SaleHeader {
  const locationId = settings.defaultLocationId ?? settings.locations[0]?.id ?? null;
  const location = settings.locations.find((l) => l.id === locationId);
  const orderTax = settings.business.defaultSalesTaxId;
  const defaultDiscount = settings.business.defaultSalesDiscount;
  return {
    locationId,
    customer: walkInOption(settings),
    priceGroupId: location?.sellingPriceGroupId ?? null,
    discountType: 'percentage',
    discountAmount: defaultDiscount && !isZero(dec(defaultDiscount)) && settings.permissions.canDiscount ? defaultDiscount : '0',
    taxRateId: !forPos || !settings.posSettings.disable_order_tax ? (orderTax && settings.taxRates.some((t) => t.id === orderTax) ? orderTax : null) : null,
    shippingCharges: '',
    shippingDetails: '',
    shippingAddress: '',
    shippingStatus: '',
    deliveredTo: '',
    deliveryPerson: null,
    additionalExpenses: emptyExpenses(),
    saleNote: '',
    staffNote: '',
    commissionAgentId: null,
    payTermNumber: '',
    payTermType: '',
    transactionDate: '',
    invoiceNo: '',
    invoiceSchemeId: null,
    status: 'final',
  };
}

export function statusOfSale(sale: Pick<SaleDetail, 'status' | 'subStatus'>): SaleStatusInput {
  if (sale.status === 'final') return 'final';
  return sale.subStatus === 'quotation' ? 'quotation' : sale.subStatus === 'proforma' ? 'proforma' : 'draft';
}

export function customerOfSale(sale: SaleDetail): CustomerOption | null {
  const c = sale.customer;
  if (!c) return null;
  const label = c.supplierBusinessName && c.supplierBusinessName !== c.name ? `${c.name} - ${c.supplierBusinessName}` : c.name;
  return {
    id: c.id,
    label: c.contactCode ? `${label} (${c.contactCode})` : label,
    mobile: c.mobile,
    customerGroupId: sale.customerGroupId,
    isDefault: c.isDefault,
    payTermNumber: sale.payTermNumber,
    payTermType: sale.payTermType,
    balance: c.balance,
    creditLimit: c.creditLimit,
  };
}

/** Header state of a stored sale (docs/SALES-API.md 4.8 "Loading a sale into the edit form"). */
export function headerFromSale(sale: SaleDetail, settings: SaleSettings): SaleHeader {
  const expenses = emptyExpenses();
  sale.totals.additionalExpenses.slice(0, 4).forEach((e, i) => (expenses[i] = { key: e.key, value: e.value }));
  const discountAmount = sale.totals.discountAmount;
  return {
    locationId: sale.locationId,
    customer: customerOfSale(sale),
    priceGroupId: sale.sellingPriceGroupId,
    discountType: sale.totals.discountType ?? 'percentage',
    discountAmount: isZero(dec(discountAmount)) ? '0' : discountAmount,
    taxRateId: sale.totals.orderTaxId,
    shippingCharges: isZero(dec(sale.totals.shippingCharges)) ? '' : sale.totals.shippingCharges,
    shippingDetails: sale.shipping.details ?? '',
    shippingAddress: sale.shipping.address ?? '',
    shippingStatus: sale.shipping.status ?? '',
    deliveredTo: sale.shipping.deliveredTo ?? '',
    deliveryPerson: sale.shipping.deliveryPerson,
    additionalExpenses: expenses,
    saleNote: sale.saleNote ?? '',
    staffNote: sale.staffNote ?? '',
    commissionAgentId: sale.commissionAgentId,
    payTermNumber: sale.payTermNumber ? String(sale.payTermNumber) : '',
    payTermType: sale.payTermType === 'days' || sale.payTermType === 'months' ? sale.payTermType : '',
    transactionDate: instantToLocalInput(sale.transactionDate, settings.business.timeZone),
    invoiceNo: sale.invoiceNo ?? '',
    invoiceSchemeId: null,
    status: statusOfSale(sale),
  };
}

// ------------------------------------------------------------------------------------------------ totals

export interface CartTotals extends InvoiceMath {
  lines: LineMath[];
  itemCount: Dec;
}

export function calcCart(lines: CartLine[], header: SaleHeader, settings: SaleSettings): CartTotals {
  const cp = settings.business.currencyPrecision;
  const maths = lines.map((l) => calcCartLine(l, settings.taxRates, cp));
  const orderRate = settings.taxRates.find((t) => t.id === header.taxRateId)?.rate ?? '0';
  const invoice = calcInvoice({
    lineTotals: maths.map((m) => m.lineTotal),
    discountType: header.discountType,
    discountAmount: header.discountAmount,
    taxRate: orderRate,
    shippingCharges: header.shippingCharges,
    additionalExpenses: header.additionalExpenses.map((e) => e.value),
    roundingMultiple: settings.posSettings.amount_rounding_method ?? null,
    currencyPrecision: cp,
  });
  const itemCount = lines.reduce<Dec>((a, l) => add(a, dec(l.quantity)), ZERO);
  return { ...invoice, lines: maths, itemCount };
}

// ------------------------------------------------------------------------------------------------ payments

export interface PaymentRow {
  key: string;
  /** Existing payment (edit); undefined for a new one. */
  id?: number;
  method: string;
  amount: string;
  note: string;
  cardTransactionNumber: string;
  cardNumber: string;
  cardType: string;
  cardHolderName: string;
  chequeNumber: string;
  bankAccountNumber: string;
  transactionNo: string;
  accountId: number | null;
}

export function newPaymentRow(method: string, amount: string, accountId: number | null = null): PaymentRow {
  return {
    key: newKey(),
    method,
    amount,
    note: '',
    cardTransactionNumber: '',
    cardNumber: '',
    cardType: '',
    cardHolderName: '',
    chequeNumber: '',
    bankAccountNumber: '',
    transactionNo: '',
    accountId,
  };
}

export function paymentRowFromDetail(p: SalePaymentDetail): PaymentRow {
  return {
    key: newKey(),
    id: p.id,
    method: p.method,
    amount: p.amount,
    note: p.note ?? '',
    cardTransactionNumber: p.cardTransactionNumber ?? '',
    cardNumber: p.cardNumber ?? '',
    cardType: p.cardType ?? '',
    cardHolderName: p.cardHolderName ?? '',
    chequeNumber: p.chequeNumber ?? '',
    bankAccountNumber: p.bankAccountNumber ?? '',
    transactionNo: p.transactionNo ?? '',
    accountId: p.accountId,
  };
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Payment rows to send. New rows of zero are dropped (the API does too); stored rows are kept so they can be zeroed or edited. */
export function paymentBodies(rows: PaymentRow[]): SalePaymentBody[] {
  return rows
    .filter((r) => r.id !== undefined || !isZero(dec(r.amount)))
    .map((r) => ({
      ...(r.id !== undefined ? { id: r.id } : {}),
      method: r.method,
      amount: toText(dec(r.amount)),
      note: orNull(r.note),
      cardTransactionNumber: r.method === 'card' ? orNull(r.cardTransactionNumber) : null,
      cardNumber: r.method === 'card' ? orNull(r.cardNumber) : null,
      cardType: r.method === 'card' ? orNull(r.cardType) : null,
      cardHolderName: r.method === 'card' ? orNull(r.cardHolderName) : null,
      chequeNumber: r.method === 'cheque' ? orNull(r.chequeNumber) : null,
      bankAccountNumber: r.method === 'bank_transfer' ? orNull(r.bankAccountNumber) : null,
      transactionNo: r.method.startsWith('custom_pay_') ? orNull(r.transactionNo) : null,
      accountId: r.method === 'advance' ? null : r.accountId,
    }));
}

// ------------------------------------------------------------------------------------------------ request body

export interface PaymentsInput {
  rows: PaymentRow[];
  /** Cash handed back: `max(0, tendered - finalTotal)`. */
  change: Dec;
  /** The stored change-return payment when editing. */
  changePaymentId: number | null;
}

export interface BuildBodyArgs {
  settings: SaleSettings;
  header: SaleHeader;
  lines: CartLine[];
  status: SaleStatusInput;
  isDirectSale: boolean;
  isSuspend?: boolean;
  isCreditSale?: boolean;
  /** undefined = send no payments (suspend, credit, draft, or "leave the stored payments alone" on update). */
  payments?: PaymentsInput;
  /** Update: the date text the form was loaded with; the date is only sent when the user changed it. */
  initialDate?: string;
  /** Update: the invoice number the sale was loaded with; it is only sent when the user changed it (a draft number must not become the invoice number). */
  initialInvoiceNo?: string;
  /** Update: the stored values below are accepted even without permission, so they are always sent. */
  isUpdate: boolean;
}

export function lineBodies(lines: CartLine[], inlineTax: boolean): SaleLineBody[] {
  return lines.map((l) => {
    const hasDiscount = !isZero(dec(l.discountAmount));
    return {
      ...(l.id !== undefined ? { id: l.id } : {}),
      productId: l.productId,
      variationId: l.variationId,
      quantity: toText(dec(l.quantity)),
      unitPrice: toText(dec(l.unitPrice)),
      ...(hasDiscount ? { lineDiscountType: l.discountType, lineDiscountAmount: toText(dec(l.discountAmount)) } : {}),
      ...(inlineTax ? { taxId: l.taxId } : {}),
      subUnitId: l.subUnitId,
      sellLineNote: orNull(l.note),
      ...(l.lotNoLineId !== null ? { lotNoLineId: l.lotNoLineId } : {}),
    };
  });
}

export function buildSaleBody(a: BuildBodyArgs): SaleBody {
  const { settings, header, status } = a;
  if (header.locationId === null || header.customer === null) throw new Error('location and customer are required');
  const hasDiscount = !isZero(dec(header.discountAmount));
  const expenses = header.additionalExpenses.filter((e) => e.key.trim() !== '' && !isZero(dec(e.value)));
  const body: SaleBody = {
    status,
    isDirectSale: a.isDirectSale,
    locationId: header.locationId,
    contactId: header.customer.id,
    sellingPriceGroupId: header.priceGroupId,
    lines: lineBodies(a.lines, settings.business.enableInlineTax),
    taxRateId: header.taxRateId,
    ...(hasDiscount ? { discountType: header.discountType, discountAmount: toText(dec(header.discountAmount)) } : {}),
    saleNote: orNull(header.saleNote),
    staffNote: orNull(header.staffNote),
  };
  if (a.isSuspend) body.isSuspend = true;
  if (a.isCreditSale) body.isCreditSale = true;

  // shipping: send what is filled in (the API refuses it without access_shipping unless it equals the stored values)
  if (!isZero(dec(header.shippingCharges)) || a.isUpdate || settings.permissions.canShip) {
    body.shippingCharges = isZero(dec(header.shippingCharges)) ? '0' : toText(dec(header.shippingCharges));
  }
  if (settings.permissions.canShip || a.isUpdate) {
    body.shippingDetails = orNull(header.shippingDetails);
    body.shippingAddress = orNull(header.shippingAddress);
    body.shippingStatus = orNull(header.shippingStatus);
    body.deliveredTo = orNull(header.deliveredTo);
    body.deliveryPerson = header.deliveryPerson;
  }
  if (expenses.length > 0 || a.isUpdate) body.additionalExpenses = expenses.map((e) => ({ key: e.key.trim(), value: toText(dec(e.value)) }));
  if (header.commissionAgentId !== null || a.isUpdate) body.commissionAgentId = header.commissionAgentId;
  if (a.isDirectSale) {
    if (header.payTermNumber.trim() !== '' && header.payTermType !== '') {
      body.payTermNumber = Number(header.payTermNumber);
      body.payTermType = header.payTermType;
    }
    if (header.invoiceNo.trim() !== '' && (!a.isUpdate || header.invoiceNo.trim() !== (a.initialInvoiceNo ?? ''))) body.invoiceNo = header.invoiceNo.trim();
    if (header.invoiceSchemeId !== null && status === 'final') body.invoiceSchemeId = header.invoiceSchemeId;
  }
  if (header.transactionDate && (!a.isUpdate || header.transactionDate !== a.initialDate)) {
    const iso = localInputToInstant(header.transactionDate, settings.business.timeZone);
    if (iso) body.transactionDate = iso;
  }
  if (a.payments) {
    body.payments = paymentBodies(a.payments.rows);
    body.changeReturn = toText(a.payments.change);
    if (a.payments.changePaymentId !== null) body.changeReturnPaymentId = a.payments.changePaymentId;
  }
  return body;
}

/** Remaining amount for the first payment row of a sale (total minus what is already paid by `rows`). */
export function dueOf(total: Dec, rows: PaymentRow[]): Dec {
  const paid = rows.reduce<Dec>((a, r) => add(a, dec(r.amount)), ZERO);
  const d = sub(total, paid);
  return isNeg(d) ? ZERO : d;
}
