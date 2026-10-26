import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { UnitDto } from './unit.dto';
import { resolveBaseUnit } from './unit.rules';

const SORTABLE = ['actual_name', 'short_name', 'id'] as const;

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = {
      deleted_at: null,
      ...(q.search ? { OR: [{ actual_name: { contains: q.search } }, { short_name: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      db.units.findMany({ where, orderBy: orderBy(q, SORTABLE, 'actual_name'), ...skipTake(q) }),
      db.units.count({ where }),
    ]);
    const baseIds = [...new Set(rows.map((r) => r.base_unit_id).filter((x): x is number => x != null))];
    const bases = baseIds.length ? await db.units.findMany({ where: { id: { in: baseIds } } }) : [];
    const baseName = new Map(bases.map((b) => [b.id, b.actual_name]));
    return paginated(
      rows.map((r) => ({ ...r, base_unit_name: r.base_unit_id ? baseName.get(r.base_unit_id) ?? null : null })),
      total,
      q,
    );
  }

  /** Dropdown options. Base units only by default, which is what product forms need. */
  async options(user: AuthUser, onlyBase = true) {
    const db = this.prisma.forTenant(user.businessId);
    const rows = await db.units.findMany({
      where: { deleted_at: null, ...(onlyBase ? { base_unit_id: null } : {}) },
      orderBy: { actual_name: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: `${r.actual_name} (${r.short_name})`, allowDecimal: r.allow_decimal }));
  }

  async get(user: AuthUser, id: number) {
    const unit = await this.prisma.forTenant(user.businessId).units.findFirst({ where: { id, deleted_at: null } });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async create(user: AuthUser, dto: UnitDto) {
    const db = this.prisma.forTenant(user.businessId);
    const base = resolveBaseUnit(dto);
    await this.assertBaseExists(user, base.base_unit_id);
    const now = new Date();
    return db.units.create({
      data: {
        business_id: user.businessId,
        actual_name: dto.actualName,
        short_name: dto.shortName,
        allow_decimal: dto.allowDecimal,
        ...base,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async update(user: AuthUser, id: number, dto: UnitDto) {
    await this.get(user, id);
    const base = resolveBaseUnit(dto, id);
    await this.assertBaseExists(user, base.base_unit_id);
    return this.prisma.forTenant(user.businessId).units.update({
      where: { id },
      data: { actual_name: dto.actualName, short_name: dto.shortName, allow_decimal: dto.allowDecimal, ...base, updated_at: new Date() },
    });
  }

  /** Same rule as Laravel: a unit used by a product cannot be deleted. A base unit with sub-units is protected too. */
  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    await this.get(user, id);
    const [products, subUnits] = await Promise.all([
      db.products.count({ where: { unit_id: id } }),
      db.units.count({ where: { base_unit_id: id, deleted_at: null } }),
    ]);
    if (products > 0) throw new BadRequestException('This unit is used by products and cannot be deleted');
    if (subUnits > 0) throw new BadRequestException('This unit is the base of other units and cannot be deleted');
    await db.units.update({ where: { id }, data: { deleted_at: new Date() } });
    return { success: true };
  }

  private async assertBaseExists(user: AuthUser, baseId: number | null) {
    if (baseId == null) return;
    const base = await this.prisma.forTenant(user.businessId).units.findFirst({ where: { id: baseId, deleted_at: null } });
    if (!base) throw new BadRequestException('Base unit not found');
    if (base.base_unit_id != null) throw new BadRequestException('The base unit must not itself be a sub-unit');
  }
}
