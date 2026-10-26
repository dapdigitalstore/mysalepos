import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../common/can';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { ReferenceService } from '../../common/reference.service';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckContactIdQueryDto, CheckMobileQueryDto, ContactDto, ContactListQueryDto, ContactOptionsQueryDto } from './contact.dto';
import {
  actScope,
  allowedContactTypes,
  assertCanDelete,
  assertDefaultUnchanged,
  buildContactName,
  contactLabel,
  customerDue,
  detailScope,
  isVisibleToOwn,
  listScope,
  openingBalanceDue,
  planOpeningBalance,
  purchaseReturnDue,
  supplierDue,
  typeSpecificColumns,
  validateContactInput,
  type CanFn,
  type ContactAction,
  type ContactSide,
  type ContactTotals,
  type ContactType,
} from './contact.rules';

const SORTABLE = ['name', 'supplier_business_name', 'contact_id', 'mobile', 'created_at', 'id', 'balance', 'credit_limit', 'contact_status', 'city'] as const;

type Dec = Prisma.Decimal.Value | null;

/** Aggregates per contact over its transactions (same columns as Laravel ContactUtil::getContactQuery). */
interface TotalsRow extends ContactTotals {
  contact_id: number;
  opening_balance: Dec;
  opening_balance_paid: Dec;
}

const toContactType = (v: string): ContactType => (v === 'supplier' || v === 'customer' || v === 'both' ? v : 'customer');
const str = (d: Prisma.Decimal.Value | null | undefined): string => new Prisma.Decimal(d ?? 0).toString();

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceService,
  ) {}

  private canFn(user: AuthUser): CanFn {
    return (p) => can(user, p);
  }

  // ------------------------------------------------------------------ list

  async list(user: AuthUser, q: ContactListQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const side: ContactSide = q.type;
    const scope = listScope(this.canFn(user), side);

    const and: Prisma.contactsWhereInput[] = [{ deleted_at: null }, { type: { in: [side, 'both'] } }];
    if (scope.mode === 'own') and.push(await this.ownFilter(user));
    if (q.search) {
      const s = q.search.trim();
      and.push({
        OR: [{ name: { contains: s } }, { supplier_business_name: { contains: s } }, { mobile: { contains: s } }, { contact_id: { contains: s } }],
      });
    }
    if (q.status) and.push({ contact_status: q.status });
    if (q.customerGroupId && side === 'customer') and.push({ customer_group_id: q.customerGroupId });
    if (q.balance === 'advance') and.push({ balance: { gt: 0 } });
    if (q.balance === 'opening' || q.balance === 'due') {
      const all = await this.totals(user.businessId);
      const ids = all
        .filter((t) => (q.balance === 'opening' ? new Prisma.Decimal(t.opening_balance ?? 0).gt(0) : (side === 'supplier' ? supplierDue(t) : customerDue(t)).gt(0)))
        .map((t) => t.contact_id);
      and.push({ id: { in: ids } });
    }
    const where: Prisma.contactsWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      db.contacts.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.contacts.count({ where }),
    ]);

    const [totals, groupNames] = await Promise.all([this.totals(user.businessId, rows.map((r) => r.id)), this.groupNames(user, rows.map((r) => r.customer_group_id))]);
    const byId = new Map(totals.map((t) => [t.contact_id, t]));

    return paginated(
      rows.map((r) => {
        const t = byId.get(r.id) ?? ({ contact_id: r.id, opening_balance: 0, opening_balance_paid: 0 } as TotalsRow);
        return {
          ...r,
          customer_group_name: r.customer_group_id ? groupNames.get(r.customer_group_id) ?? null : null,
          opening_balance: str(t.opening_balance),
          opening_balance_paid: str(t.opening_balance_paid),
          opening_balance_due: openingBalanceDue(t.opening_balance, t.opening_balance_paid).toString(),
          due: (side === 'supplier' ? supplierDue(t) : customerDue(t)).toString(),
          return_due: (side === 'supplier' ? purchaseReturnDue(t) : new Prisma.Decimal(0)).toString(),
        };
      }),
      total,
      q,
    );
  }

  /** Dropdown options. Active contacts of the side, narrowed to the user's own contacts when they only hold view_own. */
  async options(user: AuthUser, q: ContactOptionsQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const side: ContactSide = q.type;
    const c = this.canFn(user);
    const and: Prisma.contactsWhereInput[] = [{ deleted_at: null }, { contact_status: 'active' }, { type: { in: [side, 'both'] } }];
    if (!c(`${side}.view`) && c(`${side}.view_own`)) and.push(await this.ownFilter(user));
    if (q.includeDefault === false) and.push({ is_default: false });
    if (q.search) {
      const s = q.search.trim();
      and.push({ OR: [{ name: { contains: s } }, { supplier_business_name: { contains: s } }, { mobile: { contains: s } }, { contact_id: { contains: s } }] });
    }
    const rows = await db.contacts.findMany({ where: { AND: and }, orderBy: { name: 'asc' }, take: q.limit ?? 200 });
    return rows.map((r) => ({
      id: r.id,
      label: contactLabel(r),
      mobile: r.mobile,
      customerGroupId: r.customer_group_id,
      isDefault: r.is_default,
      payTermNumber: r.pay_term_number,
      payTermType: r.pay_term_type,
      balance: r.balance,
      creditLimit: r.credit_limit,
    }));
  }

  // ---------------------------------------------------------------- detail

  async get(user: AuthUser, id: number) {
    const contact = await this.find(user, id);
    const scope = detailScope(this.canFn(user), toContactType(contact.type));
    if (!scope) throw new ForbiddenException('You do not have permission to view this contact');
    if (scope.mode === 'own') await this.assertOwnVisible(user, contact);

    const db = this.prisma.forTenant(user.businessId);
    const [totalsRows, groupNames, access, transactionCount] = await Promise.all([
      this.totals(user.businessId, [id]),
      this.groupNames(user, [contact.customer_group_id]),
      this.prisma.user_contact_access.findMany({ where: { contact_id: id }, select: { user_id: true } }),
      db.transactions.count({ where: { contact_id: id } }),
    ]);
    const t: TotalsRow = totalsRows[0] ?? { contact_id: id, opening_balance: 0, opening_balance_paid: 0 };
    return {
      ...contact,
      customer_group_name: contact.customer_group_id ? groupNames.get(contact.customer_group_id) ?? null : null,
      opening_balance: str(t.opening_balance),
      opening_balance_paid: str(t.opening_balance_paid),
      opening_balance_due: openingBalanceDue(t.opening_balance, t.opening_balance_paid).toString(),
      total_purchase: str(t.total_purchase),
      purchase_paid: str(t.purchase_paid),
      total_purchase_return: str(t.total_purchase_return),
      purchase_return_paid: str(t.purchase_return_paid),
      total_invoice: str(t.total_invoice),
      invoice_received: str(t.invoice_received),
      total_sell_return: str(t.total_sell_return),
      sell_return_paid: str(t.sell_return_paid),
      total_ledger_discount: str(t.total_ledger_discount),
      supplier_due: supplierDue(t).toString(),
      customer_due: customerDue(t).toString(),
      assigned_to_users: access.map((a) => a.user_id),
      transaction_count: transactionCount,
      can_delete: !contact.is_default && transactionCount === 0,
    };
  }

  // ---------------------------------------------------------------- create

  async create(user: AuthUser, dto: ContactDto) {
    const c = this.canFn(user);
    if (!allowedContactTypes(c, 'create').includes(dto.type)) throw new ForbiddenException('You do not have permission to create this type of contact');
    validateContactInput(dto);

    const bid = user.businessId;
    await this.assertGroup(user, dto.type, dto.customerGroupId);
    await this.assertAssignees(user, dto.assignedToUsers);

    let contactId = dto.contactId?.trim() || null;
    if (contactId) {
      if (await this.contactIdTaken(bid, contactId)) throw new ConflictException('This contact ID is already used');
    } else {
      contactId = await this.generateContactId(bid);
    }

    const plan = planOpeningBalance(null, dto.openingBalance);
    const obRef = plan.action === 'create' ? (await this.refs.next(bid, 'opening_balance')).number : null;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contacts.create({
        data: {
          business_id: bid,
          type: dto.type,
          contact_type: dto.contactType ?? 'individual',
          contact_id: contactId,
          name: buildContactName(dto),
          ...this.fieldColumns(dto),
          ...typeSpecificColumns(dto),
          created_by: user.id,
          created_at: now,
          updated_at: now,
        },
      });

      if (dto.assignedToUsers?.length) {
        await tx.user_contact_access.createMany({ data: [...new Set(dto.assignedToUsers)].map((user_id) => ({ user_id, contact_id: contact.id })) });
      }

      if (plan.action === 'create' && obRef) {
        const location = await tx.business_locations.findFirst({ where: { business_id: bid }, orderBy: { id: 'asc' }, select: { id: true } });
        await tx.transactions.create({
          data: {
            business_id: bid,
            location_id: location?.id ?? null,
            type: 'opening_balance',
            status: 'final',
            payment_status: plan.paymentStatus,
            contact_id: contact.id,
            transaction_date: now,
            total_before_tax: plan.finalTotal,
            final_total: plan.finalTotal,
            ref_no: obRef,
            created_by: user.id,
            essentials_duration: 0,
            created_at: now,
            updated_at: now,
          },
        });
      }
      return contact;
    });
  }

  // ---------------------------------------------------------------- update

  async update(user: AuthUser, id: number, dto: ContactDto) {
    const existing = await this.find(user, id);
    await this.assertMayAct(user, 'update', existing);
    const c = this.canFn(user);
    const bid = user.businessId;

    if (dto.type !== existing.type) {
      if (!allowedContactTypes(c, 'update').includes(dto.type)) throw new ForbiddenException('You do not have permission to set this type of contact');
      assertDefaultUnchanged({ isDefault: existing.is_default, type: existing.type }, { type: dto.type });
    }

    // Fields not sent keep their stored value (undefined); null clears.
    const pick = <T>(v: T | undefined, current: T): T => (v !== undefined ? v : current);
    const merged = {
      type: dto.type,
      mobile: dto.mobile,
      contactType: dto.contactType ?? (existing.contact_type === 'business' ? ('business' as const) : ('individual' as const)),
      supplierBusinessName: pick(dto.supplierBusinessName, existing.supplier_business_name),
      prefix: pick(dto.prefix, existing.prefix),
      firstName: pick(dto.firstName, existing.first_name),
      middleName: pick(dto.middleName, existing.middle_name),
      lastName: pick(dto.lastName, existing.last_name),
      payTermNumber: pick(dto.payTermNumber, existing.pay_term_number),
      payTermType: pick(dto.payTermType, existing.pay_term_type),
      creditLimit: pick(dto.creditLimit, existing.credit_limit == null ? null : Number(existing.credit_limit)),
      customerGroupId: pick(dto.customerGroupId, existing.customer_group_id),
      openingBalance: dto.openingBalance,
    };
    validateContactInput(merged, { isDefault: existing.is_default });
    await this.assertGroup(user, dto.type, merged.customerGroupId);
    await this.assertAssignees(user, dto.assignedToUsers);

    const newContactId = dto.contactId === undefined ? undefined : dto.contactId?.trim() || null;
    if (newContactId && newContactId !== existing.contact_id && (await this.contactIdTaken(bid, newContactId, id))) {
      throw new ConflictException('This contact ID is already used');
    }

    // Opening balance: only touched when the form sends it.
    const db = this.prisma.forTenant(bid);
    let plan = planOpeningBalance(null, null);
    let obTx: { id: number } | null = null;
    if (dto.openingBalance !== undefined) {
      const ob = await db.transactions.findFirst({ where: { contact_id: id, type: 'opening_balance' }, orderBy: { id: 'asc' } });
      if (ob) {
        const paid = await db.transaction_payments.aggregate({ where: { transaction_id: ob.id }, _sum: { amount: true } });
        plan = planOpeningBalance({ finalTotal: ob.final_total, paid: paid._sum.amount ?? 0 }, dto.openingBalance);
        obTx = { id: ob.id };
      } else {
        plan = planOpeningBalance(null, dto.openingBalance);
      }
    }
    const obRef = plan.action === 'create' ? (await this.refs.next(bid, 'opening_balance')).number : null;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contacts.update({
        where: { id },
        data: {
          type: dto.type,
          ...(dto.contactType ? { contact_type: dto.contactType } : {}),
          ...(newContactId !== undefined ? { contact_id: newContactId } : {}),
          // The walk-in customer keeps its name unless a new one is typed.
          name: buildContactName(merged) || (existing.is_default ? existing.name : ''),
          ...this.fieldColumns(dto),
          pay_term_number: merged.payTermNumber,
          pay_term_type: merged.payTermType,
          ...typeSpecificColumns({ type: dto.type, customerGroupId: merged.customerGroupId, creditLimit: merged.creditLimit }),
          updated_at: now,
        },
      });

      if (dto.assignedToUsers !== undefined) {
        await tx.user_contact_access.deleteMany({ where: { contact_id: id } });
        if (dto.assignedToUsers.length) {
          await tx.user_contact_access.createMany({ data: [...new Set(dto.assignedToUsers)].map((user_id) => ({ user_id, contact_id: id })) });
        }
      }

      if (plan.action === 'update' && obTx) {
        await tx.transactions.update({
          where: { id: obTx.id },
          data: { final_total: plan.finalTotal, total_before_tax: plan.finalTotal, payment_status: plan.paymentStatus, updated_at: now },
        });
      } else if (plan.action === 'create' && obRef) {
        const location = await tx.business_locations.findFirst({ where: { business_id: bid }, orderBy: { id: 'asc' }, select: { id: true } });
        await tx.transactions.create({
          data: {
            business_id: bid,
            location_id: location?.id ?? null,
            type: 'opening_balance',
            status: 'final',
            payment_status: plan.paymentStatus,
            contact_id: id,
            transaction_date: now,
            total_before_tax: plan.finalTotal,
            final_total: plan.finalTotal,
            ref_no: obRef,
            created_by: user.id,
            essentials_duration: 0,
            created_at: now,
            updated_at: now,
          },
        });
      }
      return contact;
    });
  }

  // ---------------------------------------------------------- status/delete

  /** Laravel ContactController::updateStatus: flips active <-> inactive. */
  async toggleStatus(user: AuthUser, id: number) {
    const contact = await this.find(user, id);
    await this.assertMayAct(user, 'update', contact);
    const next = contact.contact_status === 'active' ? 'inactive' : 'active';
    assertDefaultUnchanged({ isDefault: contact.is_default, type: contact.type }, { status: next });
    const updated = await this.prisma.forTenant(user.businessId).contacts.update({ where: { id }, data: { contact_status: next, updated_at: new Date() } });
    return { id: updated.id, contact_status: updated.contact_status };
  }

  /** Soft delete. Laravel refuses when the contact has any transaction (including an opening balance). */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const contact = await this.find(user, id);
    await this.assertMayAct(user, 'delete', contact);
    const transactionCount = await db.transactions.count({ where: { contact_id: id } });
    assertCanDelete({ isDefault: contact.is_default }, transactionCount);
    await db.$transaction([
      // A login created for this contact (CRM portal) is disabled, as in Laravel.
      db.users.updateMany({ where: { crm_contact_id: id }, data: { allow_login: false } }),
      db.contacts.update({ where: { id }, data: { deleted_at: new Date(), updated_at: new Date() } }),
    ]);
    return { success: true };
  }

  // ---------------------------------------------------------------- checks

  /** Laravel checkMobile: a warning, not a block (the same number may legitimately repeat). */
  async checkMobile(user: AuthUser, q: CheckMobileQueryDto) {
    const rows = await this.prisma.forTenant(user.businessId).contacts.findMany({
      where: { deleted_at: null, mobile: { endsWith: q.mobile.trim() }, ...(q.excludeId ? { id: { not: q.excludeId } } : {}) },
      select: { id: true, name: true, contact_id: true },
      take: 10,
    });
    return { exists: rows.length > 0, contacts: rows.map((r) => ({ id: r.id, name: r.name, contactId: r.contact_id })) };
  }

  async checkContactId(user: AuthUser, q: CheckContactIdQueryDto) {
    return { available: !(await this.contactIdTaken(user.businessId, q.contactId.trim(), q.excludeId)) };
  }

  // --------------------------------------------------------------- helpers

  private async find(user: AuthUser, id: number) {
    const contact = await this.prisma.forTenant(user.businessId).contacts.findFirst({ where: { id, deleted_at: null } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  private async assignedIds(user: AuthUser): Promise<number[]> {
    const rows = await this.prisma.user_contact_access.findMany({ where: { user_id: user.id }, select: { contact_id: true } });
    return rows.map((r) => r.contact_id);
  }

  /** `view_own`: contacts the user created or was given access to. */
  private async ownFilter(user: AuthUser): Promise<Prisma.contactsWhereInput> {
    const ids = await this.assignedIds(user);
    return { OR: [{ created_by: user.id }, ...(ids.length ? [{ id: { in: ids } }] : [])] };
  }

  private async assertOwnVisible(user: AuthUser, contact: { id: number; created_by: number }) {
    if (!isVisibleToOwn(contact, user.id, await this.assignedIds(user), contact.id)) throw new ForbiddenException('You do not have permission to view this contact');
  }

  private async assertMayAct(user: AuthUser, action: ContactAction, contact: { id: number; type: string; created_by: number }) {
    const scope = actScope(this.canFn(user), action, toContactType(contact.type));
    if (!scope) throw new ForbiddenException('You do not have permission for this action');
    if (scope === 'own') await this.assertOwnVisible(user, contact);
  }

  private async contactIdTaken(businessId: number, contactId: string, excludeId?: number): Promise<boolean> {
    const count = await this.prisma.forTenant(businessId).contacts.count({
      where: { deleted_at: null, contact_id: contactId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    return count > 0;
  }

  /** Next CO0001-style id, skipping any that was typed in by hand earlier. */
  private async generateContactId(businessId: number): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const { number } = await this.refs.next(businessId, 'contacts');
      if (!(await this.contactIdTaken(businessId, number))) return number;
    }
    throw new ConflictException('Could not generate a free contact ID, please type one');
  }

  private async assertGroup(user: AuthUser, type: ContactType, groupId: number | null | undefined) {
    if (type === 'supplier' || groupId == null) return;
    const g = await this.prisma.forTenant(user.businessId).customer_groups.findFirst({ where: { id: groupId }, select: { id: true } });
    if (!g) throw new BadRequestException('Customer group not found');
  }

  private async assertAssignees(user: AuthUser, ids: number[] | undefined) {
    if (!ids?.length) return;
    const unique = [...new Set(ids)];
    const found = await this.prisma.forTenant(user.businessId).users.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new BadRequestException('One or more assigned users were not found');
  }

  private async groupNames(user: AuthUser, ids: (number | null)[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((x): x is number => x != null))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.forTenant(user.businessId).customer_groups.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Straight column mapping of the form fields (undefined = not sent, null = cleared). */
  private fieldColumns(dto: ContactDto) {
    return {
      supplier_business_name: dto.supplierBusinessName,
      prefix: dto.prefix,
      first_name: dto.firstName,
      middle_name: dto.middleName,
      last_name: dto.lastName,
      mobile: dto.mobile.trim(),
      alternate_number: dto.alternateNumber,
      landline: dto.landline,
      email: dto.email,
      dob: dto.dob === undefined ? undefined : dto.dob === null ? null : new Date(`${dto.dob}T00:00:00.000Z`),
      tax_number: dto.taxNumber,
      address_line_1: dto.addressLine1,
      address_line_2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      zip_code: dto.zipCode,
      land_mark: dto.landMark,
      street_name: dto.streetName,
      building_number: dto.buildingNumber,
      additional_number: dto.additionalNumber,
      shipping_address: dto.shippingAddress,
      position: dto.position,
      pay_term_number: dto.payTermNumber,
      pay_term_type: dto.payTermType,
    } satisfies Prisma.contactsUncheckedUpdateInput;
  }

  /**
   * Per-contact transaction aggregates (opening balance, purchases, invoices, returns, ledger discounts).
   * With `ids` only those contacts are summed; without, every contact of the business.
   */
  private async totals(businessId: number, ids?: number[]): Promise<TotalsRow[]> {
    if (ids && ids.length === 0) return [];
    const idFilter = ids ? Prisma.sql`AND t.contact_id IN (${Prisma.join(ids)})` : Prisma.empty;
    const subFilter = ids ? Prisma.sql`AND contact_id IN (${Prisma.join(ids)})` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<(Omit<TotalsRow, 'contact_id'> & { contact_id: bigint | number })[]>(Prisma.sql`
      SELECT t.contact_id AS contact_id,
        SUM(IF(t.type = 'opening_balance', t.final_total, 0)) AS opening_balance,
        SUM(IF(t.type = 'opening_balance', COALESCE(p.paid, 0), 0)) AS opening_balance_paid,
        SUM(IF(t.type = 'purchase', t.final_total, 0)) AS total_purchase,
        SUM(IF(t.type = 'purchase', COALESCE(p.paid, 0), 0)) AS purchase_paid,
        SUM(IF(t.type = 'purchase_return', t.final_total, 0)) AS total_purchase_return,
        SUM(IF(t.type = 'purchase_return', COALESCE(p.paid, 0), 0)) AS purchase_return_paid,
        SUM(IF(t.type = 'sell' AND t.status = 'final', t.final_total, 0)) AS total_invoice,
        SUM(IF(t.type = 'sell' AND t.status = 'final', COALESCE(p.net_paid, 0), 0)) AS invoice_received,
        SUM(IF(t.type = 'sell_return', t.final_total, 0)) AS total_sell_return,
        SUM(IF(t.type = 'sell_return', COALESCE(p.paid, 0), 0)) AS sell_return_paid,
        SUM(IF(t.type = 'ledger_discount', t.final_total, 0)) AS total_ledger_discount
      FROM transactions t
      LEFT JOIN (
        SELECT tp.transaction_id, SUM(tp.amount) AS paid, SUM(IF(tp.is_return = 1, -1 * tp.amount, tp.amount)) AS net_paid
        FROM transaction_payments tp
        WHERE tp.transaction_id IN (SELECT id FROM transactions WHERE business_id = ${businessId} AND contact_id IS NOT NULL ${subFilter})
        GROUP BY tp.transaction_id
      ) p ON p.transaction_id = t.id
      WHERE t.business_id = ${businessId} AND t.contact_id IS NOT NULL ${idFilter}
      GROUP BY t.contact_id`);
    // Raw queries return UNSIGNED INT columns as BigInt; ids must be plain numbers to match Prisma ids and serialise to JSON.
    return rows.map((r) => ({ ...r, contact_id: Number(r.contact_id) }));
  }
}
