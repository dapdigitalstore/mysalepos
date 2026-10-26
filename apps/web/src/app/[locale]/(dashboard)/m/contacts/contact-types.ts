export type ContactType = 'supplier' | 'customer' | 'both';
export type ContactSide = 'supplier' | 'customer';

/** A contact as returned by GET /contacts (list rows) and GET /contacts/:id (detail adds the summary fields). */
export interface Contact {
  id: number;
  type: ContactType;
  contact_type: string | null;
  contact_id: string | null;
  contact_status: string;
  is_default: boolean;
  name: string | null;
  supplier_business_name: string | null;
  prefix: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string;
  alternate_number: string | null;
  landline: string | null;
  dob: string | null;
  tax_number: string | null;
  pay_term_number: number | null;
  pay_term_type: 'days' | 'months' | null;
  credit_limit: string | null;
  balance: string;
  customer_group_id: number | null;
  customer_group_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip_code: string | null;
  land_mark: string | null;
  street_name: string | null;
  building_number: string | null;
  additional_number: string | null;
  shipping_address: string | null;
  created_at: string | null;
  opening_balance_due?: string;
  due?: string;
  return_due?: string;
}

export interface ContactDetail extends Contact {
  opening_balance: string;
  opening_balance_paid: string;
  opening_balance_due: string;
  total_purchase: string;
  purchase_paid: string;
  total_invoice: string;
  invoice_received: string;
  supplier_due: string;
  customer_due: string;
  transaction_count: number;
  can_delete: boolean;
}

export interface Option {
  id: number;
  label: string;
}

type CanFn = (...permissions: string[]) => boolean;

/** Same rule as the API (contact.rules.ts allowedContactTypes): which types a user may pick when saving a contact. */
export function allowedTypes(can: CanFn, action: 'create' | 'update'): ContactType[] {
  const side = (s: ContactSide) => can(`${s}.${action}`, `${s}.view_own`);
  const types: ContactType[] = [];
  if (side('supplier')) types.push('supplier');
  if (side('customer')) types.push('customer');
  if ((can(`supplier.${action}`) && can(`customer.${action}`)) || can('supplier.view_own', 'customer.view_own')) types.push('both');
  return types;
}

/** Side(s) a contact type belongs to, for permission checks in the UI. */
export function sidesOf(type: ContactType): ContactSide[] {
  return type === 'both' ? ['supplier', 'customer'] : [type];
}

/** Can the user perform `action` on a contact of this type? (view_own users act on the contacts the API lets them see.) */
export function canAct(can: CanFn, action: 'update' | 'delete', type: ContactType): boolean {
  return sidesOf(type).some((s) => can(`${s}.${action}`, `${s}.view_own`));
}

export function displayName(c: Pick<Contact, 'name' | 'supplier_business_name'>): string {
  return c.name || c.supplier_business_name || '-';
}

export function payTermText(c: Pick<Contact, 'pay_term_number' | 'pay_term_type'>, unit: (k: 'days' | 'months') => string): string {
  return c.pay_term_number && c.pay_term_type ? `${c.pay_term_number} ${unit(c.pay_term_type)}` : '';
}
