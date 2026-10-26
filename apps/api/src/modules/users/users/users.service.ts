import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, users } from '@prisma/client';
import { verifyLaravelPassword } from '../../../auth/laravel-hash';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import { ReferenceService } from '../../../common/reference.service';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpatieAccess } from '../access/spatie-access';
import { displayRoleName, isAdminRole } from '../roles/role.rules';
import { hashLaravelPassword } from './password';
import { personalInfoColumns } from './user-columns';
import { ChangePasswordDto, ProfileDto, UserDto } from './user.dto';
import {
  assertCanManageTarget,
  assertLocationsValid,
  assertRoleAssignable,
  assertRoleChangeAllowed,
  assertSelfEditSafe,
  assertUserDeletable,
  cleanCommissionPercent,
  cleanMaxDiscountPercent,
  formatDob,
  fullName,
  isTruthySetting,
  locationAccessOf,
  parseBankDetails,
  planLocationPermissions,
  planLogin,
  usernameSuffix,
  validatePassword,
  type LocationAccess,
} from './user.rules';

const SORTABLE = ['first_name', 'username', 'email', 'id'] as const;
const USERNAME_SETTING = 'enable_business_based_username';
const BAD_USERNAME_RETRIES = 5;

type UserRow = users;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SpatieAccess,
    private readonly reference: ReferenceService,
  ) {}

  // ------------------------------------------------------------------ lists

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where: Prisma.usersWhereInput = {
      deleted_at: null,
      user_type: 'user',
      is_cmmsn_agnt: false,
      ...(q.search
        ? {
            OR: [
              { username: { contains: q.search } },
              { first_name: { contains: q.search } },
              { last_name: { contains: q.search } },
              { surname: { contains: q.search } },
              { email: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.users.findMany({ where, orderBy: orderBy(q, SORTABLE, 'first_name'), ...skipTake(q) }),
      db.users.count({ where }),
    ]);
    const roles = await this.access.rolesOfUsers(rows.map((r) => r.id));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        username: r.username,
        fullName: fullName(r),
        email: r.email,
        allowLogin: r.allow_login,
        status: r.status,
        roleId: roles.get(r.id)?.id ?? null,
        roleName: roles.has(r.id) ? displayRoleName(roles.get(r.id)?.name ?? '', user.businessId) : null,
      })),
      total,
      q,
    );
  }

  /** Dropdown of the business users (Laravel `User::forDropdown`). Commission agents only when asked for. */
  async options(user: AuthUser, includeCommissionAgents: boolean) {
    const rows = await this.prisma.forTenant(user.businessId).users.findMany({
      where: { deleted_at: null, user_type: 'user', ...(includeCommissionAgents ? {} : { is_cmmsn_agnt: false }) },
      orderBy: { first_name: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: fullName(r) }));
  }

  /** Whether usernames get the business suffix (shown next to the username field). */
  async formMeta(user: AuthUser) {
    return { usernameSuffix: await this.usernameSuffix(user.businessId) };
  }

  /** Contact search for the "allow selected contacts" picker (Laravel used /contacts/customers). */
  async contactLookup(user: AuthUser, search: string | undefined) {
    const term = (search ?? '').trim();
    const rows = await this.prisma.forTenant(user.businessId).contacts.findMany({
      where: {
        deleted_at: null,
        ...(term
          ? { OR: [{ name: { contains: term } }, { supplier_business_name: { contains: term } }, { mobile: { contains: term } }, { contact_id: { contains: term } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows.map((c) => ({ id: c.id, label: contactLabel(c) }));
  }

  // ----------------------------------------------------------------- detail

  async get(user: AuthUser, id: number) {
    const row = await this.findUser(user.businessId, id);
    return this.detail(user.businessId, row);
  }

  /** The signed-in user's own record. */
  async me(user: AuthUser) {
    const row = await this.prisma.forTenant(user.businessId).users.findFirst({ where: { id: user.id, deleted_at: null } });
    if (!row) throw new NotFoundException('User not found');
    return this.detail(user.businessId, row);
  }

  private async detail(businessId: number, row: UserRow) {
    const [role, permissionNames] = await Promise.all([
      this.access.rolesOfUsers([row.id]).then((m) => m.get(row.id)),
      this.access.userPermissionNames(this.prisma, row.id),
    ]);
    const locations = locationAccessOf(permissionNames);
    const contactIds = row.selected_contacts
      ? (await this.prisma.user_contact_access.findMany({ where: { user_id: row.id }, select: { contact_id: true } })).map((c) => c.contact_id)
      : [];
    const contacts = contactIds.length
      ? await this.prisma.forTenant(businessId).contacts.findMany({ where: { id: { in: contactIds }, deleted_at: null } })
      : [];
    return {
      id: row.id,
      surname: row.surname ?? '',
      firstName: row.first_name,
      lastName: row.last_name ?? '',
      fullName: fullName(row),
      username: row.username,
      email: row.email ?? '',
      language: row.language,
      status: row.status,
      allowLogin: row.allow_login,
      hasPassword: !!row.password,
      roleId: role?.id ?? null,
      roleName: role ? displayRoleName(role.name, businessId) : null,
      isAdmin: role ? isAdminRole(role.name, businessId) : false,
      cmmsnPercent: row.cmmsn_percent.toFixed(2),
      maxSalesDiscountPercent: row.max_sales_discount_percent ? row.max_sales_discount_percent.toFixed(2) : null,
      isEnableServiceStaffPin: row.is_enable_service_staff_pin,
      /** The PIN itself is never sent back; leave the field empty to keep it. */
      hasServiceStaffPin: !!row.service_staff_pin,
      accessAllLocations: locations.all,
      locationIds: locations.ids,
      selectedContacts: row.selected_contacts,
      contacts: contacts.map((c) => ({ id: c.id, label: contactLabel(c) })),
      dob: formatDob(row.dob),
      gender: row.gender ?? '',
      maritalStatus: row.marital_status ?? '',
      bloodGroup: row.blood_group ?? '',
      contactNumber: row.contact_number ?? '',
      altNumber: row.alt_number ?? '',
      familyNumber: row.family_number ?? '',
      fbLink: row.fb_link ?? '',
      twitterLink: row.twitter_link ?? '',
      socialMedia1: row.social_media_1 ?? '',
      socialMedia2: row.social_media_2 ?? '',
      customField1: row.custom_field_1 ?? '',
      customField2: row.custom_field_2 ?? '',
      customField3: row.custom_field_3 ?? '',
      customField4: row.custom_field_4 ?? '',
      guardianName: row.guardian_name ?? '',
      idProofName: row.id_proof_name ?? '',
      idProofNumber: row.id_proof_number ?? '',
      permanentAddress: row.permanent_address ?? '',
      currentAddress: row.current_address ?? '',
      bankDetails: parseBankDetails(row.bank_details),
    };
  }

  // ------------------------------------------------------------ create/edit

  async create(user: AuthUser, dto: UserDto) {
    const businessId = user.businessId;
    const suffix = await this.usernameSuffix(businessId);
    const status = dto.status ?? 'active';
    const login = planLogin({ allowLogin: dto.allowLogin, username: dto.username, password: dto.password }, { suffix, isNew: true, hasPassword: false });

    const role = await this.findRole(businessId, dto.roleId);
    assertRoleAssignable(role, businessId, isAdminUser(user));
    await this.assertEmailFree(dto.email);
    const locations = await this.checkedLocations(businessId, dto);
    const contactIds = await this.checkedContacts(businessId, dto);
    const pin = this.servicePin(dto, null);

    let username: string | null = null;
    if (login.allowLogin) {
      username = login.username ?? (await this.generateUsername(businessId, suffix));
      await this.assertUsernameFree(username);
    }
    const passwordHash = login.allowLogin && login.password ? await hashLaravelPassword(login.password) : null;

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.users.create({
        data: {
          ...personalInfoColumns(dto),
          user_type: 'user',
          business_id: businessId,
          email: dto.email.trim(),
          username,
          password: passwordHash,
          allow_login: login.allowLogin,
          status,
          is_cmmsn_agnt: false,
          cmmsn_percent: cleanCommissionPercent(dto.cmmsnPercent),
          max_sales_discount_percent: cleanMaxDiscountPercent(dto.maxSalesDiscountPercent),
          is_enable_service_staff_pin: dto.isEnableServiceStaffPin === true,
          service_staff_pin: pin,
          selected_contacts: dto.selectedContacts === true,
          created_at: now,
          updated_at: now,
        },
      });
      await this.access.setUserRole(tx, row.id, role.id);
      const plan = planLocationPermissions([], locations);
      await this.access.grantUserPermissions(tx, row.id, plan.grant);
      await this.replaceContactAccess(tx, row.id, dto.selectedContacts === true ? contactIds : []);
      return row;
    });
    return { id: created.id };
  }

  async update(user: AuthUser, id: number, dto: UserDto) {
    const businessId = user.businessId;
    const existing = await this.findUser(businessId, id);
    const status = dto.status ?? 'active';
    const actorIsAdmin = isAdminUser(user);

    const roles = await this.access.rolesOfUsers([id]);
    const previousRole = roles.get(id);
    const targetIsAdmin = previousRole ? isAdminRole(previousRole.name, businessId) : false;
    assertCanManageTarget(targetIsAdmin, actorIsAdmin);
    assertSelfEditSafe({ actorId: user.id, targetId: id, allowLogin: dto.allowLogin, status });

    const role = await this.findRole(businessId, dto.roleId);
    if (previousRole?.id !== role.id) {
      assertRoleAssignable(role, businessId, actorIsAdmin);
      assertRoleChangeAllowed({
        previousRoleId: previousRole?.id ?? 0,
        newRoleId: role.id,
        targetIsAdmin,
        adminCount: targetIsAdmin ? await this.access.countAdmins(businessId) : 0,
      });
    }

    const suffix = await this.usernameSuffix(businessId);
    const login = planLogin(
      { allowLogin: dto.allowLogin, username: dto.username, password: dto.password },
      { suffix, isNew: false, hasPassword: !!existing.password, existingUsername: existing.username },
    );
    if (changed(dto.email, existing.email)) await this.assertEmailFree(dto.email, id);
    const locations = await this.checkedLocations(businessId, dto);
    const contactIds = await this.checkedContacts(businessId, dto);
    const pin = this.servicePin(dto, existing.service_staff_pin);

    let username: string | null = null;
    let passwordHash: string | null | undefined;
    if (login.allowLogin) {
      username = login.username ?? (await this.generateUsername(businessId, suffix));
      if (username !== existing.username) await this.assertUsernameFree(username, id);
      passwordHash = login.password ? await hashLaravelPassword(login.password) : undefined; // undefined keeps the current hash
    } else {
      passwordHash = null; // Laravel clears username and password when login is switched off
    }

    const currentPermissions = await this.access.userPermissionNames(this.prisma, id);
    const plan = planLocationPermissions(currentPermissions, locations);
    const selected = dto.selectedContacts === true;

    await this.prisma.$transaction(async (tx) => {
      await tx.users.updateMany({
        where: { id, business_id: businessId },
        data: {
          ...personalInfoColumns(dto),
          email: dto.email.trim(),
          username,
          ...(passwordHash !== undefined ? { password: passwordHash } : {}),
          allow_login: login.allowLogin,
          status,
          cmmsn_percent: cleanCommissionPercent(dto.cmmsnPercent),
          max_sales_discount_percent: cleanMaxDiscountPercent(dto.maxSalesDiscountPercent),
          is_enable_service_staff_pin: dto.isEnableServiceStaffPin === true,
          service_staff_pin: pin,
          selected_contacts: selected,
          updated_at: new Date(),
        },
      });
      if (previousRole?.id !== role.id) await this.access.setUserRole(tx, id, role.id);
      await this.access.revokeUserPermissions(tx, id, plan.revoke);
      await this.access.grantUserPermissions(tx, id, plan.grant);
      await this.replaceContactAccess(tx, id, selected ? contactIds : []);
    });
    return { id };
  }

  /** Soft delete (the row stays so past sales keep their seller). */
  async remove(user: AuthUser, id: number) {
    const businessId = user.businessId;
    await this.findUser(businessId, id);
    const role = (await this.access.rolesOfUsers([id])).get(id);
    const targetIsAdmin = role ? isAdminRole(role.name, businessId) : false;
    assertCanManageTarget(targetIsAdmin, isAdminUser(user));
    assertUserDeletable({
      actorId: user.id,
      targetId: id,
      targetIsAdmin,
      adminCount: targetIsAdmin ? await this.access.countAdmins(businessId) : 0,
    });
    await this.prisma.forTenant(businessId).users.updateMany({ where: { id }, data: { deleted_at: new Date(), updated_at: new Date() } });
    return { success: true };
  }

  // ---------------------------------------------------------------- profile

  async updateProfile(user: AuthUser, dto: ProfileDto) {
    const current = await this.prisma.forTenant(user.businessId).users.findFirst({ where: { id: user.id, deleted_at: null }, select: { email: true } });
    if (!current) throw new NotFoundException('User not found');
    if (changed(dto.email, current.email)) await this.assertEmailFree(dto.email, user.id);
    const res = await this.prisma.forTenant(user.businessId).users.updateMany({
      where: { id: user.id, deleted_at: null },
      data: { ...personalInfoColumns(dto), email: dto.email.trim(), updated_at: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('User not found');
    return { success: true };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const row = await this.prisma.forTenant(user.businessId).users.findFirst({ where: { id: user.id, deleted_at: null } });
    if (!row) throw new NotFoundException('User not found');
    // 400 on purpose: the web client treats 401 as an expired session and signs the user out
    if (!row.password || !(await verifyLaravelPassword(dto.currentPassword, row.password))) {
      throw new BadRequestException('The current password is incorrect');
    }
    const next = validatePassword(dto.newPassword);
    await this.prisma.forTenant(user.businessId).users.updateMany({
      where: { id: user.id },
      data: { password: await hashLaravelPassword(next), updated_at: new Date() },
    });
    return { success: true };
  }

  // ---------------------------------------------------------------- helpers

  /** Regular users only: commission agents have their own endpoints. */
  private async findUser(businessId: number, id: number): Promise<UserRow> {
    const row = await this.prisma.forTenant(businessId).users.findFirst({
      where: { id, deleted_at: null, user_type: 'user', is_cmmsn_agnt: false },
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  private async findRole(businessId: number, roleId: number) {
    const role = await this.prisma.forTenant(businessId).roles.findFirst({ where: { id: roleId } });
    if (!role) throw new BadRequestException('Role not found');
    return role;
  }

  private async usernameSuffix(businessId: number): Promise<string> {
    const setting = await this.prisma.system.findFirst({ where: { key: USERNAME_SETTING } });
    return usernameSuffix(businessId, isTruthySetting(setting?.value));
  }

  /** Next free generated username (`username` reference counter, then the business suffix). */
  private async generateUsername(businessId: number, suffix: string): Promise<string> {
    for (let i = 0; i < BAD_USERNAME_RETRIES; i++) {
      const candidate = `${(await this.reference.next(businessId, 'username')).number}${suffix}`;
      if (!(await this.prisma.users.findFirst({ where: { username: candidate }, select: { id: true } }))) return candidate;
    }
    throw new ConflictException('Could not generate a free username, please type one');
  }

  /** Usernames are unique across all businesses and deleted users keep theirs (unique index). */
  private async assertUsernameFree(username: string, exceptId?: number) {
    const clash = await this.prisma.users.findFirst({
      where: { username, ...(exceptId !== undefined ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('This username is already taken');
  }

  /** Laravel's check-email rule: an email belongs to one active user across the whole system. */
  private async assertEmailFree(email: string, exceptId?: number) {
    const clash = await this.prisma.users.findFirst({
      where: { email: email.trim(), deleted_at: null, ...(exceptId !== undefined ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('This email is already used by another user');
  }

  private async checkedLocations(businessId: number, dto: UserDto): Promise<LocationAccess> {
    const access: LocationAccess = { all: dto.accessAllLocations, ids: [...new Set(dto.locationIds ?? [])] };
    if (!access.all && access.ids.length > 0) {
      const found = await this.prisma.forTenant(businessId).business_locations.findMany({ where: { id: { in: access.ids }, deleted_at: null }, select: { id: true } });
      assertLocationsValid(access, new Set(found.map((l) => l.id)));
    }
    return access;
  }

  private async checkedContacts(businessId: number, dto: UserDto): Promise<number[]> {
    if (dto.selectedContacts !== true) return [];
    const ids = [...new Set(dto.selectedContactIds ?? [])];
    if (ids.length === 0) return [];
    const found = await this.prisma.forTenant(businessId).contacts.findMany({ where: { id: { in: ids }, deleted_at: null }, select: { id: true } });
    const ok = new Set(found.map((c) => c.id));
    const bad = ids.filter((i) => !ok.has(i));
    if (bad.length > 0) throw new BadRequestException(`Unknown contact: ${bad.join(', ')}`);
    return ids;
  }

  /** Service staff PIN: required while the option is on and none is stored yet; cleared when the option is off. */
  private servicePin(dto: UserDto, current: string | null): string | null {
    if (dto.isEnableServiceStaffPin !== true) return null;
    const typed = (dto.serviceStaffPin ?? '').trim();
    if (typed) return typed;
    if (current) return current;
    throw new BadRequestException('Service staff PIN is required when the option is enabled');
  }

  private async replaceContactAccess(tx: Prisma.TransactionClient, userId: number, contactIds: number[]) {
    await tx.user_contact_access.deleteMany({ where: { user_id: userId } });
    if (contactIds.length > 0) await tx.user_contact_access.createMany({ data: contactIds.map((contact_id) => ({ user_id: userId, contact_id })) });
  }
}

/** Only a changed email is checked for clashes, so old records that already share one can still be edited. */
function changed(next: string, previous: string | null): boolean {
  return next.trim().toLowerCase() !== (previous ?? '').trim().toLowerCase();
}

function isAdminUser(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin'>): boolean {
  return user.isAdmin || user.isSuperadmin;
}

function contactLabel(c: { name: string | null; supplier_business_name: string | null; mobile: string }): string {
  const name = [c.supplier_business_name, c.name].filter(Boolean).join(' - ');
  return `${name || '-'} (${c.mobile})`;
}
