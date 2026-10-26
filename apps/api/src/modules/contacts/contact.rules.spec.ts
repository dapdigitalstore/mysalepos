import { Prisma } from '@prisma/client';
import {
  allowedContactTypes,
  assertCanDelete,
  assertDefaultUnchanged,
  buildContactName,
  actScope,
  contactLabel,
  customerDue,
  detailScope,
  exceedsCreditLimit,
  isVisibleToOwn,
  listScope,
  openingBalanceDue,
  paymentStatus,
  planOpeningBalance,
  purchaseReturnDue,
  supplierDue,
  typeSpecificColumns,
  validateContactInput,
  validatePayTerm,
  type ContactCoreInput,
} from './contact.rules';

const canOf = (...perms: string[]) => (p: string) => perms.includes(p);
const base: ContactCoreInput = { type: 'customer', mobile: '0771234567', contactType: 'individual', firstName: 'Nimal' };

describe('buildContactName', () => {
  it('joins prefix, first, middle and last name', () => {
    expect(buildContactName({ prefix: 'Mr', firstName: 'Nimal', middleName: 'K', lastName: 'Perera' })).toBe('Mr Nimal K Perera');
  });
  it('skips blank parts and trims', () => {
    expect(buildContactName({ prefix: ' ', firstName: ' Nimal ', lastName: '' })).toBe('Nimal');
  });
  it('falls back to the business name for a business contact', () => {
    expect(buildContactName({ contactType: 'business', supplierBusinessName: ' ABC Traders ' })).toBe('ABC Traders');
  });
  it('prefers the person name when both exist', () => {
    expect(buildContactName({ firstName: 'Nimal', supplierBusinessName: 'ABC' })).toBe('Nimal');
  });
});

describe('validateContactInput', () => {
  it('accepts a valid individual', () => {
    expect(() => validateContactInput(base)).not.toThrow();
  });
  it('requires a mobile number', () => {
    expect(() => validateContactInput({ ...base, mobile: '  ' })).toThrow('Mobile number is required');
    expect(() => validateContactInput({ ...base, mobile: undefined })).toThrow();
  });
  it('requires a first name for an individual', () => {
    expect(() => validateContactInput({ ...base, firstName: ' ' })).toThrow('First name is required');
  });
  it('requires a business name for a business contact, not a first name', () => {
    const biz: ContactCoreInput = { type: 'supplier', mobile: '011', contactType: 'business' };
    expect(() => validateContactInput(biz)).toThrow('Business name is required');
    expect(() => validateContactInput({ ...biz, supplierBusinessName: 'ABC' })).not.toThrow();
  });
  it('rejects an unknown contact type', () => {
    expect(() => validateContactInput({ ...base, type: 'lead' as never })).toThrow();
  });
  it('rejects negative credit limit and opening balance', () => {
    expect(() => validateContactInput({ ...base, creditLimit: -1 })).toThrow('Credit limit');
    expect(() => validateContactInput({ ...base, openingBalance: -5 })).toThrow('Opening balance');
    expect(() => validateContactInput({ ...base, creditLimit: 0, openingBalance: 0 })).not.toThrow();
  });
});

describe('validateContactInput for the default customer', () => {
  it('does not demand a mobile number or first name', () => {
    expect(() => validateContactInput({ type: 'customer', mobile: '' }, { isDefault: true })).not.toThrow();
    expect(() => validateContactInput({ type: 'customer', mobile: '' })).toThrow();
  });
  it('still validates pay term', () => {
    expect(() => validateContactInput({ type: 'customer', payTermNumber: 3 }, { isDefault: true })).toThrow();
  });
});

describe('contactLabel', () => {
  it('shows name, business and id', () => {
    expect(contactLabel({ name: 'Nimal', supplier_business_name: 'ABC', contact_id: 'CO0004' })).toBe('Nimal - ABC (CO0004)');
  });
  it('does not repeat a business name equal to the name', () => {
    expect(contactLabel({ name: 'ABC', supplier_business_name: 'ABC', contact_id: 'CO1' })).toBe('ABC (CO1)');
  });
  it('works without an id or without a name', () => {
    expect(contactLabel({ name: 'Nimal' })).toBe('Nimal');
    expect(contactLabel({ name: '', supplier_business_name: 'ABC', contact_id: '' })).toBe('ABC');
  });
});

describe('validatePayTerm', () => {
  it('allows both empty', () => {
    expect(() => validatePayTerm(null, null)).not.toThrow();
    expect(() => validatePayTerm()).not.toThrow();
  });
  it('allows a number with a type', () => {
    expect(() => validatePayTerm(30, 'days')).not.toThrow();
    expect(() => validatePayTerm(2, 'months')).not.toThrow();
  });
  it('rejects a half-filled pay term', () => {
    expect(() => validatePayTerm(30, null)).toThrow('both');
    expect(() => validatePayTerm(null, 'days')).toThrow('both');
  });
  it('rejects zero, negative and fractional numbers', () => {
    expect(() => validatePayTerm(0, 'days')).toThrow();
    expect(() => validatePayTerm(-24, 'days')).toThrow();
    expect(() => validatePayTerm(1.5, 'days')).toThrow();
  });
  it('rejects an unknown unit', () => {
    expect(() => validatePayTerm(3, 'weeks' as never)).toThrow();
  });
});

describe('typeSpecificColumns', () => {
  it('clears customer group and credit limit for suppliers', () => {
    expect(typeSpecificColumns({ type: 'supplier', customerGroupId: 3, creditLimit: 500 })).toEqual({ customer_group_id: null, credit_limit: null });
  });
  it('keeps them for customers and both', () => {
    expect(typeSpecificColumns({ type: 'customer', customerGroupId: 3, creditLimit: 500 })).toEqual({ customer_group_id: 3, credit_limit: 500 });
    expect(typeSpecificColumns({ type: 'both', customerGroupId: undefined, creditLimit: undefined })).toEqual({ customer_group_id: null, credit_limit: null });
  });
});

describe('permissions', () => {
  it('offers only the types the user may create', () => {
    expect(allowedContactTypes(canOf('supplier.create'), 'create')).toEqual(['supplier']);
    expect(allowedContactTypes(canOf('customer.create'), 'create')).toEqual(['customer']);
    expect(allowedContactTypes(canOf('supplier.create', 'customer.create'), 'create')).toEqual(['supplier', 'customer', 'both']);
    expect(allowedContactTypes(canOf('supplier.view'), 'create')).toEqual([]);
  });
  it('treats view_own like Laravel: it unlocks every type', () => {
    expect(allowedContactTypes(canOf('customer.view_own'), 'create')).toEqual(['customer', 'both']);
  });
  it('checks update/delete against the contact type', () => {
    expect(actScope(canOf('customer.update'), 'update', 'customer')).toBe('all');
    expect(actScope(canOf('customer.update'), 'update', 'supplier')).toBeNull();
    expect(actScope(canOf('customer.delete'), 'delete', 'both')).toBe('all');
    expect(actScope(canOf('supplier.view'), 'delete', 'supplier')).toBeNull();
  });
  it('view_own users may only act on the contacts they can see', () => {
    expect(actScope(canOf('supplier.view_own'), 'update', 'supplier')).toBe('own');
    expect(actScope(canOf('supplier.view_own', 'supplier.update'), 'update', 'supplier')).toBe('all');
  });
});

describe('visibility scope', () => {
  it('view sees all, view_own sees own, otherwise forbidden', () => {
    expect(listScope(canOf('supplier.view'), 'supplier')).toEqual({ mode: 'all' });
    expect(listScope(canOf('supplier.view_own'), 'supplier')).toEqual({ mode: 'own' });
    expect(listScope(canOf('supplier.view', 'supplier.view_own'), 'supplier')).toEqual({ mode: 'all' });
    expect(() => listScope(canOf('customer.view'), 'supplier')).toThrow();
  });
  it('detail scope follows the sides of the contact', () => {
    expect(detailScope(canOf('customer.view'), 'customer')).toEqual({ mode: 'all' });
    expect(detailScope(canOf('customer.view'), 'supplier')).toBeNull();
    expect(detailScope(canOf('customer.view'), 'both')).toEqual({ mode: 'all' });
    expect(detailScope(canOf('supplier.view_own'), 'both')).toEqual({ mode: 'own' });
  });
  it('a view_own user sees contacts they created or were assigned', () => {
    expect(isVisibleToOwn({ created_by: 5 }, 5, new Set<number>(), 10)).toBe(true);
    expect(isVisibleToOwn({ created_by: 9 }, 5, new Set([10]), 10)).toBe(true);
    expect(isVisibleToOwn({ created_by: 9 }, 5, new Set([11]), 10)).toBe(false);
  });
});

describe('default contact protection', () => {
  it('blocks deleting the walk-in customer', () => {
    expect(() => assertCanDelete({ isDefault: true }, 0)).toThrow('walk-in');
  });
  it('blocks deleting a contact that has transactions', () => {
    expect(() => assertCanDelete({ isDefault: false }, 2)).toThrow('transactions');
    expect(() => assertCanDelete({ isDefault: false }, 0)).not.toThrow();
  });
  it('keeps the walk-in customer active and a customer', () => {
    const walkIn = { isDefault: true, type: 'customer' };
    expect(() => assertDefaultUnchanged(walkIn, { status: 'inactive' })).toThrow();
    expect(() => assertDefaultUnchanged(walkIn, { type: 'supplier' })).toThrow();
    expect(() => assertDefaultUnchanged(walkIn, { type: 'customer', status: 'active' })).not.toThrow();
    expect(() => assertDefaultUnchanged({ isDefault: false, type: 'customer' }, { status: 'inactive' })).not.toThrow();
  });
});

describe('opening balance', () => {
  it('does nothing when there is no transaction and nothing entered', () => {
    expect(planOpeningBalance(null, 0)).toEqual({ action: 'none' });
    expect(planOpeningBalance(null, null)).toEqual({ action: 'none' });
    expect(planOpeningBalance(null, undefined)).toEqual({ action: 'none' });
  });
  it('creates a due transaction for a new opening balance', () => {
    const plan = planOpeningBalance(null, 1500.5);
    expect(plan.action).toBe('create');
    if (plan.action === 'create') {
      expect(plan.finalTotal.toString()).toBe('1500.5');
      expect(plan.paymentStatus).toBe('due');
    }
  });
  it('adds the already-paid amount back when editing, so payments are kept', () => {
    // 1000 opening balance, 400 paid, 600 left. The user edits the owed amount to 800.
    const plan = planOpeningBalance({ finalTotal: '1000', paid: '400' }, 800);
    expect(plan.action).toBe('update');
    if (plan.action === 'update') {
      expect(plan.finalTotal.toString()).toBe('1200');
      expect(plan.paymentStatus).toBe('partial');
    }
  });
  it('marks the transaction paid when the owed amount is cleared', () => {
    const plan = planOpeningBalance({ finalTotal: '1000', paid: '1000' }, 0);
    expect(plan.action).toBe('update');
    if (plan.action === 'update') {
      expect(plan.finalTotal.toString()).toBe('1000');
      expect(plan.paymentStatus).toBe('paid');
    }
  });
  it('goes back to due when nothing was paid', () => {
    const plan = planOpeningBalance({ finalTotal: '300', paid: '0' }, 250);
    expect(plan.action === 'update' && plan.paymentStatus).toBe('due');
  });
  it('computes payment status like Laravel', () => {
    expect(paymentStatus('100', '100')).toBe('paid');
    expect(paymentStatus('100', '150')).toBe('paid');
    expect(paymentStatus('100', '40.50')).toBe('partial');
    expect(paymentStatus('100', '0')).toBe('due');
  });
  it('computes the amount still owed without float errors', () => {
    expect(openingBalanceDue('0.3', '0.1').toString()).toBe('0.2');
    expect(openingBalanceDue(null, null).toString()).toBe('0');
  });
});

describe('balance summary', () => {
  it('supplier due = purchases - paid - ledger discount', () => {
    expect(supplierDue({ total_purchase: '1000', purchase_paid: '250.25', total_ledger_discount: '49.75' }).toString()).toBe('700');
    expect(supplierDue({}).toString()).toBe('0');
  });
  it('customer due follows the Laravel formula', () => {
    // 1000 invoiced, 300 received, 20 discount, 100 returned, 40 of the return refunded in cash
    const due = customerDue({ total_invoice: '1000', invoice_received: '300', total_ledger_discount: '20', total_sell_return: '100', sell_return_paid: '40' });
    expect(due.toString()).toBe('620');
  });
  it('purchase return due', () => {
    expect(purchaseReturnDue({ total_purchase_return: '90', purchase_return_paid: '30' }).toString()).toBe('60');
  });
  it('is exact for decimals', () => {
    expect(customerDue({ total_invoice: new Prisma.Decimal('0.3'), invoice_received: new Prisma.Decimal('0.1') }).toString()).toBe('0.2');
  });
});

describe('credit limit', () => {
  it('has no limit when null', () => {
    expect(exceedsCreditLimit(null, '999999', '1')).toBe(false);
  });
  it('allows reaching the limit exactly but not passing it', () => {
    expect(exceedsCreditLimit('1000', '600', '400')).toBe(false);
    expect(exceedsCreditLimit('1000', '600', '400.01')).toBe(true);
  });
});
