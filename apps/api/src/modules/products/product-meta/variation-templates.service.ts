import { Injectable, NotFoundException } from '@nestjs/common';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { VariationTemplateDto } from './variation-template.dto';
import { assertTemplateDeletable, assertValuesRemovable, cleanName, diffTemplateValues } from './variation-template.rules';

const SORTABLE = ['name', 'id'] as const;

interface TemplateRow {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
  variation_value_templates: { id: number; name: string }[];
}

@Injectable()
export class VariationTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where = q.search
      ? { OR: [{ name: { contains: q.search } }, { variation_value_templates: { some: { name: { contains: q.search } } } }] }
      : {};
    const [rows, total] = await Promise.all([
      db.variation_templates.findMany({
        where,
        include: { variation_value_templates: { orderBy: { id: 'asc' } } },
        orderBy: orderBy(q, SORTABLE, 'name'),
        ...skipTake(q),
      }),
      db.variation_templates.count({ where }),
    ]);
    const usage = await this.usage(rows.map((r) => r.id));
    return paginated(rows.map((r) => this.present(r, usage.get(r.id) ?? 0)), total, q);
  }

  /** Dropdown for the product form: each template with its values. */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).variation_templates.findMany({
      include: { variation_value_templates: { orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.name,
      values: r.variation_value_templates.map((v) => ({ id: v.id, label: v.name })),
    }));
  }

  async get(user: AuthUser, id: number) {
    const row = await this.find(user, id);
    const usage = await this.usage([id]);
    return this.present(row, usage.get(id) ?? 0);
  }

  async create(user: AuthUser, dto: VariationTemplateDto) {
    const name = cleanName(dto.name);
    // A new template has no existing values, so every cleaned row is created.
    const { toCreate } = diffTemplateValues([], dto.values.map((v) => ({ name: v.name })));
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.variation_templates.create({
        data: { business_id: user.businessId, name, created_at: now, updated_at: now },
      });
      await tx.variation_value_templates.createMany({
        data: toCreate.map((n) => ({ variation_template_id: tpl.id, name: n, created_at: now, updated_at: now })),
      });
      return tpl.id;
    });
    return this.get(user, id);
  }

  /**
   * Edit = rename the template, rename / add / remove values. Existing values keep their ids; only values missing
   * from the payload are deleted, and only when no product uses them. Renames are pushed to the products that
   * already copied the name (product_variations / variations), as Laravel does.
   */
  async update(user: AuthUser, id: number, dto: VariationTemplateDto) {
    const current = await this.find(user, id);
    const name = cleanName(dto.name);
    const diff = diffTemplateValues(current.variation_value_templates, dto.values);

    if (diff.toDelete.length > 0) {
      const used = await this.prisma.variations.findMany({
        where: { variation_value_id: { in: diff.toDelete.map((v) => v.id) }, deleted_at: null },
        select: { variation_value_id: true },
        distinct: ['variation_value_id'],
      });
      assertValuesRemovable(
        diff.toDelete,
        used.map((u) => u.variation_value_id).filter((x): x is number => x != null),
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (name !== current.name) {
        await tx.variation_templates.update({ where: { id, business_id: user.businessId }, data: { name, updated_at: now } });
        await tx.product_variations.updateMany({ where: { variation_template_id: id }, data: { name, updated_at: now } });
      } else {
        await tx.variation_templates.update({ where: { id, business_id: user.businessId }, data: { updated_at: now } });
      }
      for (const r of diff.toRename) {
        await tx.variation_value_templates.update({ where: { id: r.id }, data: { name: r.name, updated_at: now } });
        await tx.variations.updateMany({ where: { variation_value_id: r.id }, data: { name: r.name, updated_at: now } });
      }
      if (diff.toDelete.length > 0) {
        await tx.variation_value_templates.deleteMany({
          where: { variation_template_id: id, id: { in: diff.toDelete.map((v) => v.id) } },
        });
      }
      if (diff.toCreate.length > 0) {
        await tx.variation_value_templates.createMany({
          data: diff.toCreate.map((n) => ({ variation_template_id: id, name: n, created_at: now, updated_at: now })),
        });
      }
    });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: number) {
    await this.find(user, id);
    const usage = await this.usage([id]);
    assertTemplateDeletable(usage.get(id) ?? 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.variation_value_templates.deleteMany({ where: { variation_template_id: id } });
      await tx.variation_templates.deleteMany({ where: { id, business_id: user.businessId } });
    });
    return { success: true };
  }

  private async find(user: AuthUser, id: number) {
    const row = await this.prisma.forTenant(user.businessId).variation_templates.findFirst({
      where: { id },
      include: { variation_value_templates: { orderBy: { id: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Variation not found');
    return row;
  }

  /** Number of product variations created from each template. */
  private async usage(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.product_variations.groupBy({
      by: ['variation_template_id'],
      where: { variation_template_id: { in: ids } },
      _count: { _all: true },
    });
    return new Map(rows.filter((r) => r.variation_template_id != null).map((r) => [r.variation_template_id as number, r._count._all]));
  }

  private present(r: TemplateRow, usage: number) {
    return {
      id: r.id,
      name: r.name,
      values: r.variation_value_templates.map((v) => ({ id: v.id, name: v.name })),
      usage,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }
}
