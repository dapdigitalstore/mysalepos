import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UserAccess {
  isAdmin: boolean;
  permissions: string[];
}

interface CacheEntry {
  at: number;
  value: UserAccess;
}

const TTL_MS = 30_000;
/** Value of model_type that Laravel/Spatie stores for users (bound as a parameter so the backslash is not an SQL escape). */
const MODEL_TYPE = 'App\\User';

/** Reads the Spatie tables (model_has_roles / roles / role_has_permissions / permissions) written by Laravel. */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: number, businessId: number): Promise<UserAccess> {
    const key = `${businessId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const roles = await this.prisma.$queryRaw<{ id: number; name: string }[]>`
      SELECT r.id, r.name FROM roles r
      JOIN model_has_roles m ON m.role_id = r.id
      WHERE m.model_id = ${userId} AND m.model_type = ${MODEL_TYPE}`;
    const roleIds = roles.map((r) => r.id);

    let permissions: string[] = [];
    if (roleIds.length > 0) {
      const rows = await this.prisma.$queryRaw<{ name: string }[]>`
        SELECT DISTINCT p.name FROM permissions p
        JOIN role_has_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id IN (${Prisma.join(roleIds)})`;
      permissions = rows.map((r) => r.name);
    }
    // direct user permissions (model_has_permissions)
    const direct = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT p.name FROM permissions p
      JOIN model_has_permissions mp ON mp.permission_id = p.id
      WHERE mp.model_id = ${userId} AND mp.model_type = ${MODEL_TYPE}`;
    permissions = [...new Set([...permissions, ...direct.map((r) => r.name)])];

    const value: UserAccess = { isAdmin: roles.some((r) => r.name === `Admin#${businessId}`), permissions };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

