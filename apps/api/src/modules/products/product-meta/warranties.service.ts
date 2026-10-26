import { Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { WarrantyDto } from './warranty.dto';
import { assertWarrantyDeletable, normalizeWarranty, warrantyLabel } from './warranty.rules';

const SORTABLE = ['name', 'duration', 'duration_type', 'id'] as const;

@Injectable()
export class WarrantiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = q.search ? { OR: [{ name: { contains: q.search } }, { description: { contains: q.search } }] } : {};
    const [rows, total] = await Promise.all([
      db.warranties.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.warranties.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).warranties.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: warrantyLabel(r.name, r.duration, r.duration_type) }));
  }

  async get(user: AuthUser, id: number) {
    const row = await this.prisma.forTenant(user.businessId).warranties.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Warranty not found');
    return row;
  }

  async create(user: AuthUser, dto: WarrantyDto) {
    const data = normalizeWarranty(dto);
    const now = new Date();
    return this.prisma.forTenant(user.businessId).warranties.create({
      data: { business_id: user.businessId, ...data, created_at: now, updated_at: now },
    });
  }

  async update(user: AuthUser, id: number, dto: WarrantyDto) {
    await this.get(user, id);
    const data = normalizeWarranty(dto);
    return this.prisma.forTenant(user.businessId).warranties.update({ where: { id }, data: { ...data, updated_at: new Date() } });
  }

  /** Laravel has no delete for warranties (the action is an empty stub); here it is allowed only while nothing uses the warranty. */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await this.get(user, id);
    const [products, sellLines] = await Promise.all([
      db.products.count({ where: { warranty_id: id } }),
      this.countSellLines(id),
    ]);
    assertWarrantyDeletable({ products, sellLines });
    await db.warranties.delete({ where: { id } });
    return { success: true };
  }

  /** sell_line_warranties has no primary key, so Prisma ignores it. */
  private async countSellLines(warrantyId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ c: bigint | number }[]>`SELECT COUNT(*) AS c FROM sell_line_warranties WHERE warranty_id = ${warrantyId}`;
    return Number(rows[0]?.c ?? 0);
  }
}
