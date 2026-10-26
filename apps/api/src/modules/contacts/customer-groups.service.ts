import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../common/pagination';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerGroupDto } from './customer-group.dto';
import { resolveCustomerGroupPricing } from './customer-group.rules';

const SORTABLE = ['name', 'amount', 'id'] as const;

@Injectable()
export class CustomerGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = q.search ? { name: { contains: q.search } } : {};
    const [rows, total] = await Promise.all([
      db.customer_groups.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.customer_groups.count({ where }),
    ]);
    const spgIds = [...new Set(rows.map((r) => r.selling_price_group_id).filter((x): x is number => x != null))];
    const spgs = spgIds.length ? await db.selling_price_groups.findMany({ where: { id: { in: spgIds } }, select: { id: true, name: true } }) : [];
    const spgName = new Map(spgs.map((s) => [s.id, s.name]));
    const counts = rows.length
      ? await db.contacts.groupBy({ by: ['customer_group_id'], where: { deleted_at: null, customer_group_id: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
      : [];
    const used = new Map(counts.map((c) => [c.customer_group_id, c._count._all]));
    return paginated(
      rows.map((r) => ({
        ...r,
        selling_price_group_name: r.selling_price_group_id ? spgName.get(r.selling_price_group_id) ?? null : null,
        contacts_count: used.get(r.id) ?? 0,
      })),
      total,
      q,
    );
  }

  /** Dropdown for contact forms and filters. */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).customer_groups.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: r.name, amount: r.amount, priceCalculationType: r.price_calculation_type, sellingPriceGroupId: r.selling_price_group_id }));
  }

  /** Selling price groups a customer group can point at. */
  async priceGroups(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).selling_price_groups.findMany({ where: { deleted_at: null, is_active: true }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: r.name }));
  }

  async get(user: AuthUser, id: number) {
    const group = await this.prisma.forTenant(user.businessId).customer_groups.findFirst({ where: { id } });
    if (!group) throw new NotFoundException('Customer group not found');
    return group;
  }

  async create(user: AuthUser, dto: CustomerGroupDto) {
    const pricing = resolveCustomerGroupPricing(dto);
    await this.assertPriceGroupExists(user, pricing.selling_price_group_id);
    const now = new Date();
    return this.prisma.forTenant(user.businessId).customer_groups.create({
      data: { business_id: user.businessId, name: dto.name.trim(), ...pricing, created_by: user.id, created_at: now, updated_at: now },
    });
  }

  async update(user: AuthUser, id: number, dto: CustomerGroupDto) {
    await this.get(user, id);
    const pricing = resolveCustomerGroupPricing(dto);
    await this.assertPriceGroupExists(user, pricing.selling_price_group_id);
    return this.prisma.forTenant(user.businessId).customer_groups.update({
      where: { id },
      data: { name: dto.name.trim(), ...pricing, updated_at: new Date() },
    });
  }

  /**
   * Laravel hard-deletes the group (the table has no deleted_at) and leaves contacts pointing at it.
   * Here the contacts are detached first so none keeps a dangling group id.
   */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await this.get(user, id);
    await db.$transaction([
      db.contacts.updateMany({ where: { customer_group_id: id }, data: { customer_group_id: null, updated_at: new Date() } }),
      db.customer_groups.deleteMany({ where: { id } }),
    ]);
    return { success: true };
  }

  private async assertPriceGroupExists(user: AuthUser, id: number | null) {
    if (id == null) return;
    const spg = await this.prisma.forTenant(user.businessId).selling_price_groups.findFirst({ where: { id, deleted_at: null } });
    if (!spg) throw new BadRequestException('Selling price group not found');
  }
}
