import { Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { CategoryDto } from './category.dto';
import { assertValidParent } from './category.rules';

const SORTABLE = ['name', 'short_code', 'id'] as const;
const PRODUCT = 'product';

/** Product categories (category_type = 'product'); other category types belong to their own modules. */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = {
      deleted_at: null,
      category_type: PRODUCT,
      ...(q.search ? { OR: [{ name: { contains: q.search } }, { short_code: { contains: q.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      db.categories.findMany({ where, orderBy: orderBy(q, SORTABLE, 'name'), ...skipTake(q) }),
      db.categories.count({ where }),
    ]);
    const parentIds = [...new Set(rows.map((r) => r.parent_id).filter((id) => id > 0))];
    const parents = parentIds.length ? await db.categories.findMany({ where: { id: { in: parentIds } } }) : [];
    const parentName = new Map(parents.map((p) => [p.id, p.name]));
    return paginated(rows.map((r) => ({ ...r, parent_name: r.parent_id > 0 ? parentName.get(r.parent_id) ?? null : null })), total, q);
  }

  /** parentId=0 (default) gives main categories; parentId=<id> gives that category's sub-categories. */
  async options(user: AuthUser, parentId = 0) {
    const rows = await this.prisma.forTenant(user.businessId).categories.findMany({
      where: { deleted_at: null, category_type: PRODUCT, parent_id: parentId },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({ id: c.id, label: c.name }));
  }

  async get(user: AuthUser, id: number) {
    const cat = await this.prisma.forTenant(user.businessId).categories.findFirst({ where: { id, deleted_at: null, category_type: PRODUCT } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  async create(user: AuthUser, dto: CategoryDto) {
    const parentId = dto.parentId ?? 0;
    await this.checkParent(user, undefined, parentId);
    const now = new Date();
    return this.prisma.forTenant(user.businessId).categories.create({
      data: {
        business_id: user.businessId,
        name: dto.name,
        short_code: dto.shortCode ?? null,
        description: dto.description ?? null,
        parent_id: parentId,
        category_type: PRODUCT,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async update(user: AuthUser, id: number, dto: CategoryDto) {
    await this.get(user, id);
    const parentId = dto.parentId ?? 0;
    await this.checkParent(user, id, parentId);
    return this.prisma.forTenant(user.businessId).categories.update({
      where: { id },
      data: { name: dto.name, short_code: dto.shortCode ?? null, description: dto.description ?? null, parent_id: parentId, updated_at: new Date() },
    });
  }

  async remove(user: AuthUser, id: number) {
    await this.get(user, id);
    await this.prisma.forTenant(user.businessId).categories.update({ where: { id }, data: { deleted_at: new Date() } });
    return { success: true };
  }

  private async checkParent(user: AuthUser, selfId: number | undefined, parentId: number) {
    if (parentId === 0) return;
    const db = this.prisma.forTenant(user.businessId);
    const parent = await db.categories.findFirst({ where: { id: parentId, deleted_at: null, category_type: PRODUCT } });
    if (!parent) throw new NotFoundException('Parent category not found');
    const selfHasChildren = selfId !== undefined ? (await db.categories.count({ where: { parent_id: selfId, deleted_at: null } })) > 0 : false;
    assertValidParent({ selfId, parentId, parentIsMain: parent.parent_id === 0, selfHasChildren });
  }
}
