import { Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandDto } from './brand.dto';

const SORTABLE = ['name', 'id'] as const;

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = { deleted_at: null, ...(q.search ? { name: { contains: q.search } } : {}) };
    const [rows, total] = await Promise.all([
      db.brands.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.brands.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).brands.findMany({ where: { deleted_at: null }, orderBy: { name: 'asc' } });
    return rows.map((b) => ({ id: b.id, label: b.name }));
  }

  async get(user: AuthUser, id: number) {
    const brand = await this.prisma.forTenant(user.businessId).brands.findFirst({ where: { id, deleted_at: null } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  create(user: AuthUser, dto: BrandDto) {
    const now = new Date();
    return this.prisma.forTenant(user.businessId).brands.create({
      data: {
        business_id: user.businessId,
        name: dto.name,
        description: dto.description ?? null,
        ...(dto.useForRepair !== undefined ? { use_for_repair: dto.useForRepair } : {}),
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async update(user: AuthUser, id: number, dto: BrandDto) {
    await this.get(user, id);
    return this.prisma.forTenant(user.businessId).brands.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description ?? null,
        ...(dto.useForRepair !== undefined ? { use_for_repair: dto.useForRepair } : {}),
        updated_at: new Date(),
      },
    });
  }

  /** Soft delete, same as Laravel (a brand may still be referenced by older products). */
  async remove(user: AuthUser, id: number) {
    await this.get(user, id);
    await this.prisma.forTenant(user.businessId).brands.update({ where: { id }, data: { deleted_at: new Date() } });
    return { success: true };
  }
}
