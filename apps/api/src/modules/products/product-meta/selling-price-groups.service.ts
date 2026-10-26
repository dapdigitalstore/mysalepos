import { Injectable, NotFoundException } from '@nestjs/common';
import { can } from '../../../common/can';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SellingPriceGroupDto } from './selling-price-group.dto';
import { normalizePriceGroup, priceGroupPermissionName, toggledActive, usableGroups } from './selling-price-group.rules';

const SORTABLE = ['name', 'is_active', 'id'] as const;
const GUARD = 'web';

@Injectable()
export class SellingPriceGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = {
      deleted_at: null,
      ...(q.search ? { OR: [{ name: { contains: q.search } }, { description: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      db.selling_price_groups.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.selling_price_groups.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  /** Active groups this user may use (they hold the selling_price_group.<id> permission). */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).selling_price_groups.findMany({
      where: { deleted_at: null, is_active: true },
      orderBy: { name: 'asc' },
    });
    return usableGroups(rows, (p) => can(user, p)).map((r) => ({ id: r.id, label: r.name }));
  }

  async get(user: AuthUser, id: number) {
    const row = await this.prisma.forTenant(user.businessId).selling_price_groups.findFirst({ where: { id, deleted_at: null } });
    if (!row) throw new NotFoundException('Selling price group not found');
    return row;
  }

  /** Creates the group and its `selling_price_group.<id>` permission together, as Laravel does. */
  async create(user: AuthUser, dto: SellingPriceGroupDto) {
    const data = normalizePriceGroup(dto);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.selling_price_groups.create({
        data: { business_id: user.businessId, ...data, is_active: true, created_at: now, updated_at: now },
      });
      const name = priceGroupPermissionName(group.id);
      const existing = await tx.permissions.findFirst({ where: { name, guard_name: GUARD } });
      if (!existing) await tx.permissions.create({ data: { name, guard_name: GUARD, created_at: now, updated_at: now } });
      return group;
    });
  }

  async update(user: AuthUser, id: number, dto: SellingPriceGroupDto) {
    await this.get(user, id);
    const data = normalizePriceGroup(dto);
    return this.prisma.forTenant(user.businessId).selling_price_groups.update({ where: { id }, data: { ...data, updated_at: new Date() } });
  }

  async toggleActive(user: AuthUser, id: number) {
    const group = await this.get(user, id);
    return this.prisma.forTenant(user.businessId).selling_price_groups.update({
      where: { id },
      data: { is_active: toggledActive(group.is_active), updated_at: new Date() },
    });
  }

  /**
   * Soft delete (like Laravel). Laravel leaves the permission behind; here it is removed together with the group,
   * and the roles that held it, so a deleted group does not linger in role screens. Group ids are never reused.
   */
  async remove(user: AuthUser, id: number) {
    await this.get(user, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.selling_price_groups.updateMany({ where: { id, business_id: user.businessId }, data: { deleted_at: now, updated_at: now } });
      const perm = await tx.permissions.findFirst({ where: { name: priceGroupPermissionName(id), guard_name: GUARD } });
      if (perm) {
        await tx.role_has_permissions.deleteMany({ where: { permission_id: perm.id } });
        await tx.model_has_permissions.deleteMany({ where: { permission_id: perm.id } });
        await tx.permissions.delete({ where: { id: perm.id } });
      }
    });
    return { success: true };
  }
}
