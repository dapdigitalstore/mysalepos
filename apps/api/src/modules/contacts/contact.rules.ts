import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const CONTACT_TYPES = ['supplier', 'customer', 'both'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export type ContactKind = 'individual' | 'business';
export type PayTermType = 'days' | 'months';
export type ContactAction = 'create' | 'update' | 'delete';
export type ContactSide = 'supplier' | 'customer';

/** `can(permission)` bound to the signed-in user (see common/can.ts). */
export type CanFn = (permission: string) => boolean;

export interface NameInput {
  contactType?: ContactKind | null;
  supplierBusinessName?: string | null;
  prefix?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}

const clean = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * Laravel builds `contacts.name` from prefix + first + middle + last name. A business contact has no
 * person name there (which leaves an empty name in lists), so fall back to the business name.
 */
export function buildContactName(input: NameInput): string {
  const person = [input.prefix, input.firstName, input.middleName, input.lastName].map(clean).filter(Boolean).join(' ');
  if (person) return person;
  return clean(input.supplierBusinessName);
}

export interface ContactCoreInput extends NameInput {
  type: ContactType;
  mobile?: string | null;
  payTermNumber?: number | null;
  payTermType?: PayTermType | null;
  creditLimit?: number | null;
  openingBalance?: number | null;
  customerGroupId?: number | null;
}

/** Cross-field validation shared by create and update. Throws a 400 with a clear message. */
export function validateContactInput(input: ContactCoreInput, opts: { isDefault?: boolean } = {}): void {
  if (!(CONTACT_TYPES as readonly string[]).includes(input.type)) throw new BadRequestException('Contact type must be supplier, customer or both');

  // The seeded walk-in customer has no mobile number or first name, so those are not demanded when editing it.
  if (!opts.isDefault) {
    if (!clean(input.mobile)) throw new BadRequestException('Mobile number is required');
    if (input.contactType === 'business') {
      if (!clean(input.supplierBusinessName)) throw new BadRequestException('Business name is required for a business contact');
    } else if (!clean(input.firstName)) {
      // individual (also the default when no kind is sent)
      throw new BadRequestException('First name is required');
    }
  }

  validatePayTerm(input.payTermNumber, input.payTermType);

  if (input.creditLimit != null && input.creditLimit < 0) throw new BadRequestException('Credit limit cannot be negative');
  if (input.openingBalance != null && input.openingBalance < 0) throw new BadRequestException('Opening balance cannot be negative');
}

/** Pay term is "number + days|months": both or neither, number is a positive whole number. */
export function validatePayTerm(number?: number | null, type?: PayTermType | null): void {
  const hasNumber = number != null;
  const hasType = type != null;
  if (!hasNumber && !hasType) return;
  if (!hasNumber || !hasType) throw new BadRequestException('Pay term needs both a number and days or months');
  if (!Number.isInteger(number) || number < 1) throw new BadRequestException('Pay term must be a whole number of 1 or more');
  if (type !== 'days' && type !== 'months') throw new BadRequestException('Pay term type must be days or months');
}

/**
 * Columns that only make sense for some contact types are cleared for the others:
 * suppliers have no customer group and no credit limit.
 */
export function typeSpecificColumns(input: Pick<ContactCoreInput, 'type' | 'customerGroupId' | 'creditLimit'>): {
  customer_group_id: number | null;
  credit_limit: number | null;
} {
  if (input.type === 'supplier') return { customer_group_id: null, credit_limit: null };
  return { customer_group_id: input.customerGroupId ?? null, credit_limit: input.creditLimit ?? null };
}

// ---------------------------------------------------------------------------
// Permissions (Laravel: supplier.* / customer.* plus the *.view_own variants)

/** Which of supplier/customer a contact of this type belongs to. */
export function sidesOf(type: ContactType): ContactSide[] {
  return type === 'both' ? ['supplier', 'customer'] : [type];
}

/** Types the user may pick when creating or editing a contact (Laravel ContactController::create). */
export function allowedContactTypes(can: CanFn, action: 'create' | 'update'): ContactType[] {
  const side = (s: ContactSide) => can(`${s}.${action}`) || can(`${s}.view_own`);
  const types: ContactType[] = [];
  if (side('supplier')) types.push('supplier');
  if (side('customer')) types.push('customer');
  const both = (can(`supplier.${action}`) && can(`customer.${action}`)) || can('supplier.view_own') || can('customer.view_own');
  if (both) types.push('both');
  return types;
}

/**
 * How far may the user create/update/delete a contact of this type? 'all' = holds the permission,
 * 'own' = only through `view_own` (Laravel lets those users manage the contacts they can see), null = not at all.
 */
export function actScope(can: CanFn, action: ContactAction, type: ContactType): 'all' | 'own' | null {
  const sides = sidesOf(type);
  if (sides.some((s) => can(`${s}.${action}`))) return 'all';
  if (sides.some((s) => can(`${s}.view_own`))) return 'own';
  return null;
}

export type ListScope = { mode: 'all' } | { mode: 'own' };

/**
 * Visibility for lists of one side (supplier or customer): `view` sees everything, `view_own` only
 * contacts the user created or was given access to, neither is forbidden.
 */
export function listScope(can: CanFn, side: ContactSide): ListScope {
  if (can(`${side}.view`)) return { mode: 'all' };
  if (can(`${side}.view_own`)) return { mode: 'own' };
  throw new ForbiddenException('You do not have permission to view these contacts');
}

/** Visibility of a single contact (any type), for the detail page. Null = not allowed at all. */
export function detailScope(can: CanFn, type: ContactType): ListScope | null {
  const sides = sidesOf(type);
  if (sides.some((s) => can(`${s}.view`))) return { mode: 'all' };
  if (sides.some((s) => can(`${s}.view_own`))) return { mode: 'own' };
  return null;
}

/** Is a contact visible under a `view_own` scope? (created by the user, or explicitly assigned to them) */
export function isVisibleToOwn(contact: { created_by: number }, userId: number, assignedContactIds: ReadonlySet<number> | number[], contactId: number): boolean {
  if (contact.created_by === userId) return true;
  return Array.isArray(assignedContactIds) ? assignedContactIds.includes(contactId) : (assignedContactIds as ReadonlySet<number>).has(contactId);
}

// ---------------------------------------------------------------------------
// Default (walk-in) contact protection and deletion

export function assertCanDelete(contact: { isDefault: boolean }, transactionCount: number): void {
  if (contact.isDefault) throw new BadRequestException('The default walk-in customer cannot be deleted');
  if (transactionCount > 0) throw new BadRequestException('This contact has transactions and cannot be deleted. Deactivate it instead');
}

/** The walk-in customer must stay an active customer, or the POS would have nobody to sell to. */
export function assertDefaultUnchanged(contact: { isDefault: boolean; type: string }, next: { type?: string; status?: string }): void {
  if (!contact.isDefault) return;
  if (next.type && next.type !== contact.type) throw new BadRequestException('The type of the default walk-in customer cannot be changed');
  if (next.status && next.status !== 'active') throw new BadRequestException('The default walk-in customer cannot be deactivated');
}

// ---------------------------------------------------------------------------
// Opening balance (Laravel ContactUtil::createNewContact / updateContact)

export type PaymentStatus = 'paid' | 'partial' | 'due';

/** Laravel TransactionUtil::calculatePaymentStatus. */
export function paymentStatus(finalTotal: Prisma.Decimal.Value, paid: Prisma.Decimal.Value): PaymentStatus {
  const total = new Prisma.Decimal(finalTotal);
  const p = new Prisma.Decimal(paid);
  if (total.lte(p)) return 'paid';
  if (p.gt(0)) return 'partial';
  return 'due';
}

export type OpeningBalancePlan =
  | { action: 'none' }
  | { action: 'create'; finalTotal: Prisma.Decimal; paymentStatus: PaymentStatus }
  | { action: 'update'; finalTotal: Prisma.Decimal; paymentStatus: PaymentStatus };

/**
 * `entered` is the opening balance still owed, as shown in the form. When the contact already has an
 * opening-balance transaction the amount already paid against it is added back, so editing never loses
 * payments. A new transaction is only created when a non-zero amount is entered.
 */
export function planOpeningBalance(
  existing: { finalTotal: Prisma.Decimal.Value; paid: Prisma.Decimal.Value } | null,
  entered: number | null | undefined,
): OpeningBalancePlan {
  const amount = new Prisma.Decimal(entered ?? 0);
  if (!existing) {
    if (amount.isZero()) return { action: 'none' };
    return { action: 'create', finalTotal: amount, paymentStatus: 'due' };
  }
  const finalTotal = amount.add(existing.paid);
  return { action: 'update', finalTotal, paymentStatus: paymentStatus(finalTotal, existing.paid) };
}

/** Opening balance still owed = transaction total minus what was paid against it. */
export function openingBalanceDue(total: Prisma.Decimal.Value | null | undefined, paid: Prisma.Decimal.Value | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(total ?? 0).sub(paid ?? 0);
}

// ---------------------------------------------------------------------------
// Balance summary (Laravel ContactUtil::getContactQuery columns)

export interface ContactTotals {
  total_purchase?: Prisma.Decimal.Value | null;
  purchase_paid?: Prisma.Decimal.Value | null;
  total_invoice?: Prisma.Decimal.Value | null;
  invoice_received?: Prisma.Decimal.Value | null;
  total_sell_return?: Prisma.Decimal.Value | null;
  sell_return_paid?: Prisma.Decimal.Value | null;
  total_purchase_return?: Prisma.Decimal.Value | null;
  purchase_return_paid?: Prisma.Decimal.Value | null;
  total_ledger_discount?: Prisma.Decimal.Value | null;
}

const d = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);

/** What we owe the supplier: purchases - paid - ledger discount. */
export function supplierDue(t: ContactTotals): Prisma.Decimal {
  return d(t.total_purchase).sub(d(t.purchase_paid)).sub(d(t.total_ledger_discount));
}

/** What the customer owes us: invoices - received - ledger discount - sell returns + refunds paid out. */
export function customerDue(t: ContactTotals): Prisma.Decimal {
  return d(t.total_invoice).sub(d(t.invoice_received)).sub(d(t.total_ledger_discount)).sub(d(t.total_sell_return)).add(d(t.sell_return_paid));
}

/** Supplier return value still to be received back from the supplier. */
export function purchaseReturnDue(t: ContactTotals): Prisma.Decimal {
  return d(t.total_purchase_return).sub(d(t.purchase_return_paid));
}

/**
 * Credit limit check used when selling on credit: the due after this sale must stay within the limit.
 * A null limit means unlimited.
 */
export function exceedsCreditLimit(creditLimit: Prisma.Decimal.Value | null | undefined, currentDue: Prisma.Decimal.Value, newAmount: Prisma.Decimal.Value): boolean {
  if (creditLimit == null) return false;
  return d(currentDue).add(d(newAmount)).gt(d(creditLimit));
}

/** Dropdown label: "Name - Business (CO0004)". The contact id is appended when there is one. */
export function contactLabel(c: { name?: string | null; supplier_business_name?: string | null; contact_id?: string | null }): string {
  const name = clean(c.name);
  const business = clean(c.supplier_business_name);
  const head = business && business !== name ? [name, business].filter(Boolean).join(' - ') : name || business;
  const id = clean(c.contact_id);
  return id ? `${head} (${id})` : head;
}
