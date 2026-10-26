import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { adminRoleName, diffPermissionSets } from '../roles/role.rules';

/**
 * Spatie stores the model class as a string. Prisma binds it as a parameter, so the backslash is never an SQL escape.
 * (mariadb prints it doubled; the stored value has a single backslash.)
 */
export const USER_MODEL_TYPE = 'App\\User';
export const GUARD = 'web';

/** Either the plain client or an interactive-transaction client. */
export type Db = Prisma.TransactionClient;

export interface UserRole {
  id: number;
  name: string;
}

/**
 * Reads and writes the Spatie permission tables (roles, permissions, model_has_roles, model_has_permissions,
 * role_has_permissions). Callers must already have checked that the role/user belongs to the caller's business:
 * these tables carry no business_id.
 */
@Injectable()
export class SpatieAccess {
  constructor(private readonly prisma: PrismaService) {}

  /** name -> id for the given permission names; missing ones are created when `createMissing` is set. */
  async permissionIds(db: Db, names: readonly string[], createMissing: boolean): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    if (names.length === 0) return ids;
    const load = async (list: string[]) => {
      const rows = await db.permissions.findMany({ where: { name: { in: list }, guard_name: GUARD }, orderBy: { id: 'asc' } });
      for (const r of rows) if (!ids.has(r.name)) ids.set(r.name, r.id);
    };
    await load([...names]);
    const missing = names.filter((n) => !ids.has(n));
    if (createMissing && missing.length > 0) {
      const now = new Date();
      await db.permissions.createMany({ data: missing.map((name) => ({ name, guard_name: GUARD, created_at: now, updated_at: now })) });
      await load(missing);
    }
    return ids;
  }

  async rolePermissionNames(db: Db, roleId: number): Promise<string[]> {
    const rows = await db.role_has_permissions.findMany({ where: { role_id: roleId }, include: { permissions: true } });
    return rows.map((r) => r.permissions.name);
  }

  /** Makes the role hold exactly `next` (an empty list clears it). */
  async setRolePermissions(db: Db, roleId: number, next: readonly string[]): Promise<void> {
    const current = await this.rolePermissionNames(db, roleId);
    const { add, remove } = diffPermissionSets(current, next);
    if (remove.length > 0) {
      const ids = await this.permissionIds(db, remove, false);
      await db.role_has_permissions.deleteMany({ where: { role_id: roleId, permission_id: { in: [...ids.values()] } } });
    }
    if (add.length > 0) {
      const ids = await this.permissionIds(db, add, true);
      await db.role_has_permissions.createMany({
        data: [...new Set(ids.values())].map((permission_id) => ({ role_id: roleId, permission_id })),
        skipDuplicates: true,
      });
    }
  }

  /** Permissions given straight to a user (model_has_permissions): location access lives here. */
  async userPermissionNames(db: Db, userId: number): Promise<string[]> {
    const rows = await db.model_has_permissions.findMany({
      where: { model_type: USER_MODEL_TYPE, model_id: BigInt(userId) },
      include: { permissions: true },
    });
    return rows.map((r) => r.permissions.name);
  }

  async grantUserPermissions(db: Db, userId: number, names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    const ids = await this.permissionIds(db, names, true);
    await db.model_has_permissions.createMany({
      data: [...new Set(ids.values())].map((permission_id) => ({ permission_id, model_type: USER_MODEL_TYPE, model_id: BigInt(userId) })),
      skipDuplicates: true,
    });
  }

  async revokeUserPermissions(db: Db, userId: number, names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    const ids = await this.permissionIds(db, names, false);
    if (ids.size === 0) return;
    await db.model_has_permissions.deleteMany({
      where: { model_type: USER_MODEL_TYPE, model_id: BigInt(userId), permission_id: { in: [...ids.values()] } },
    });
  }

  /** Role of each user (Laravel gives a user a single role through the form). */
  async rolesOfUsers(userIds: readonly number[]): Promise<Map<number, UserRole>> {
    const out = new Map<number, UserRole>();
    if (userIds.length === 0) return out;
    const rows = await this.prisma.model_has_roles.findMany({
      where: { model_type: USER_MODEL_TYPE, model_id: { in: userIds.map((i) => BigInt(i)) } },
      include: { roles: true },
    });
    for (const r of rows) out.set(Number(r.model_id), { id: r.roles.id, name: r.roles.name });
    return out;
  }

  /** Replaces the user's roles with this one role. */
  async setUserRole(db: Db, userId: number, roleId: number): Promise<void> {
    await db.model_has_roles.deleteMany({ where: { model_type: USER_MODEL_TYPE, model_id: BigInt(userId) } });
    await db.model_has_roles.create({ data: { role_id: roleId, model_type: USER_MODEL_TYPE, model_id: BigInt(userId) } });
  }

  async countUsersInRole(roleId: number, businessId: number): Promise<number> {
    const links = await this.prisma.model_has_roles.findMany({
      where: { role_id: roleId, model_type: USER_MODEL_TYPE },
      select: { model_id: true },
    });
    if (links.length === 0) return 0;
    return this.prisma.forTenant(businessId).users.count({ where: { id: { in: links.map((l) => Number(l.model_id)) }, deleted_at: null } });
  }

  /** Active (not deleted) users holding the business Admin role. */
  async countAdmins(businessId: number): Promise<number> {
    const role = await this.prisma.forTenant(businessId).roles.findFirst({ where: { name: adminRoleName(businessId) } });
    return role ? this.countUsersInRole(role.id, businessId) : 0;
  }
}
