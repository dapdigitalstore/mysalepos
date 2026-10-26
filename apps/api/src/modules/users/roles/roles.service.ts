import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpatieAccess, USER_MODEL_TYPE, GUARD } from '../access/spatie-access';
import {
  buildCatalog,
  grantablePermissionNames,
  radioGroupsByPermission,
  visiblePermissionNames,
  type CatalogContext,
} from './permission-catalog';
import { RoleDto } from './role.dto';
import {
  assertGrantable,
  assertRoleDeletable,
  assertRoleEditable,
  assertSingleChoice,
  displayRoleName,
  isAdminRole,
  isRoleLocked,
  mergeRolePermissions,
  storedRoleName,
  uniqueNames,
} from './role.rules';

const SORTABLE = ['name', 'id'] as const;

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly access: SpatieAccess) {}

  /** Modules, settings and selling price groups of the business: they decide which permissions are offered. */
  async catalogContext(businessId: number): Promise<CatalogContext> {
    const [business, groups] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: businessId }, select: { enabled_modules: true, common_settings: true, pos_settings: true } }),
      this.prisma.forTenant(businessId).selling_price_groups.findMany({ where: { deleted_at: null, is_active: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      enabledModules: parseList(business?.enabled_modules),
      commonSettings: parseObject(business?.common_settings),
      posSettings: parseObject(business?.pos_settings),
      sellingPriceGroups: groups.map((g) => ({ id: g.id, name: g.name })),
    };
  }

  async catalog(user: AuthUser) {
    const ctx = await this.catalogContext(user.businessId);
    return { groups: buildCatalog(ctx), serviceStaff: ctx.enabledModules.includes('service_staff') };
  }

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = q.search ? { name: { contains: q.search } } : {};
    const [rows, total] = await Promise.all([
      db.roles.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.roles.count({ where }),
    ]);
    const counts = await this.userCounts(user.businessId, rows.map((r) => r.id));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        name: displayRoleName(r.name, user.businessId),
        isDefault: r.is_default,
        isAdmin: isAdminRole(r.name, user.businessId),
        isServiceStaff: r.is_service_staff,
        locked: isRoleLocked(r, user.businessId),
        userCount: counts.get(r.id) ?? 0,
      })),
      total,
      q,
    );
  }

  /** Role dropdown. The Admin role is only offered to admins, like Laravel's getRolesArray. */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).roles.findMany({ orderBy: { name: 'asc' } });
    const viewerIsAdmin = user.isAdmin || user.isSuperadmin;
    return rows
      .filter((r) => viewerIsAdmin || !isAdminRole(r.name, user.businessId))
      .map((r) => ({
        id: r.id,
        label: displayRoleName(r.name, user.businessId),
        isAdmin: isAdminRole(r.name, user.businessId),
        isServiceStaff: r.is_service_staff,
      }));
  }

  async get(user: AuthUser, id: number) {
    const role = await this.findRole(user.businessId, id);
    const isAdmin = isAdminRole(role.name, user.businessId);
    // Admin holds every permission implicitly (see common/can.ts), so show all of them ticked.
    const permissions = isAdmin
      ? [...visiblePermissionNames(await this.catalogContext(user.businessId))]
      : await this.access.rolePermissionNames(this.prisma, role.id);
    return {
      id: role.id,
      name: displayRoleName(role.name, user.businessId),
      isDefault: role.is_default,
      isAdmin,
      isServiceStaff: role.is_service_staff,
      locked: isRoleLocked(role, user.businessId),
      permissions: uniqueNames(permissions),
    };
  }

  async create(user: AuthUser, dto: RoleDto) {
    const stored = storedRoleName(dto.name, user.businessId);
    await this.assertNameFree(user.businessId, stored);
    const ctx = await this.catalogContext(user.businessId);
    const permissions = this.checkedPermissions(dto.permissions, ctx);
    const now = new Date();
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roles.create({
        data: {
          name: stored,
          guard_name: GUARD,
          business_id: user.businessId,
          is_default: false,
          is_service_staff: dto.isServiceStaff === true,
          created_at: now,
          updated_at: now,
        },
      });
      await this.access.setRolePermissions(tx, created.id, permissions);
      return created;
    });
    return { id: role.id, name: displayRoleName(role.name, user.businessId) };
  }

  async update(user: AuthUser, id: number, dto: RoleDto) {
    const role = await this.findRole(user.businessId, id);
    assertRoleEditable(role, user.businessId);
    const stored = storedRoleName(dto.name, user.businessId);
    await this.assertNameFree(user.businessId, stored, id);
    const ctx = await this.catalogContext(user.businessId);
    const submitted = this.checkedPermissions(dto.permissions, ctx);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.access.rolePermissionNames(tx, id);
      const next = mergeRolePermissions(submitted, current, visiblePermissionNames(ctx));
      await tx.roles.updateMany({
        where: { id, business_id: user.businessId },
        // editable roles are never default; Laravel also clears the flag on the default Cashier role when it is edited
        data: { name: stored, is_service_staff: dto.isServiceStaff === true, is_default: false, updated_at: new Date() },
      });
      await this.access.setRolePermissions(tx, id, next);
    });
    return { id, name: displayRoleName(stored, user.businessId) };
  }

  async remove(user: AuthUser, id: number) {
    const role = await this.findRole(user.businessId, id);
    const assigned = await this.access.countUsersInRole(id, user.businessId);
    assertRoleDeletable(role, user.businessId, assigned);
    await this.prisma.$transaction(async (tx) => {
      await tx.role_has_permissions.deleteMany({ where: { role_id: id } });
      // links of already deleted users would otherwise block the delete through the foreign key
      await tx.model_has_roles.deleteMany({ where: { role_id: id, model_type: USER_MODEL_TYPE } });
      await tx.roles.deleteMany({ where: { id, business_id: user.businessId } });
    });
    return { success: true };
  }

  private checkedPermissions(raw: readonly string[], ctx: CatalogContext): string[] {
    const names = uniqueNames(raw);
    assertGrantable(names, grantablePermissionNames(ctx));
    assertSingleChoice(names, radioGroupsByPermission());
    return names;
  }

  private async findRole(businessId: number, id: number) {
    const role = await this.prisma.forTenant(businessId).roles.findFirst({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async assertNameFree(businessId: number, stored: string, exceptId?: number) {
    const clash = await this.prisma.forTenant(businessId).roles.findFirst({
      where: { name: stored, ...(exceptId !== undefined ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw new ConflictException('A role with this name already exists');
  }

  /** Active users per role, for the roles list. */
  private async userCounts(businessId: number, roleIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (roleIds.length === 0) return counts;
    const links = await this.prisma.model_has_roles.findMany({
      where: { role_id: { in: roleIds }, model_type: USER_MODEL_TYPE },
      select: { role_id: true, model_id: true },
    });
    if (links.length === 0) return counts;
    const alive = await this.prisma.forTenant(businessId).users.findMany({
      where: { id: { in: links.map((l) => Number(l.model_id)) }, deleted_at: null },
      select: { id: true },
    });
    const aliveIds = new Set(alive.map((u) => u.id));
    for (const l of links) if (aliveIds.has(Number(l.model_id))) counts.set(l.role_id, (counts.get(l.role_id) ?? 0) + 1);
    return counts;
  }
}
