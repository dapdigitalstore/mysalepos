import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { TaxGroupDto, TaxRateDto } from './tax.dto';
import { assertValidGroup, groupTaxAmount } from './tax.rules';

/** Tax rates and tax groups (a group is a tax_rates row with is_tax_group = 1; members live in group_sub_taxes). */
@Injectable()
export class TaxRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const db = this.prisma.forTenant(user.businessId);
    const [taxes, groups] = await Promise.all([
      db.tax_rates.findMany({ where: { deleted_at: null, is_tax_group: false }, orderBy: { name: 'asc' } }),
      db.tax_rates.findMany({ where: { deleted_at: null, is_tax_group: true }, orderBy: { name: 'asc' } }),
    ]);
    // Unsigned INT columns come back from $queryRaw as BigInt: convert before comparing with Prisma ids.
    const memberRows = groups.length
      ? await this.prisma.$queryRaw<{ group_tax_id: bigint; tax_id: bigint }[]>`
          SELECT group_tax_id, tax_id FROM group_sub_taxes WHERE group_tax_id IN (${Prisma.join(groups.map((g) => g.id))})`
      : [];
    const members = memberRows.map((m) => ({ group_tax_id: Number(m.group_tax_id), tax_id: Number(m.tax_id) }));
    const names = new Map(taxes.map((t) => [t.id, t.name]));
    return {
      taxes,
      groups: groups.map((g) => {
        const taxIds = members.filter((m) => m.group_tax_id === g.id).map((m) => m.tax_id);
        return { ...g, taxIds, subTaxNames: taxIds.map((id) => names.get(id) ?? '') };
      }),
    };
  }

  /** Dropdown for product/sale forms: simple taxes not reserved for groups, plus all groups. */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).tax_rates.findMany({
      where: { deleted_at: null, for_tax_group: false },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => ({ id: t.id, label: t.name, amount: t.amount, isGroup: t.is_tax_group }));
  }

  create(user: AuthUser, dto: TaxRateDto) {
    const now = new Date();
    return this.prisma.forTenant(user.businessId).tax_rates.create({
      data: {
        business_id: user.businessId,
        name: dto.name,
        amount: dto.amount,
        for_tax_group: dto.forTaxGroup ?? false,
        is_tax_group: false,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async update(user: AuthUser, id: number, dto: TaxRateDto) {
    const db = this.prisma.forTenant(user.businessId);
    const tax = await db.tax_rates.findFirst({ where: { id, deleted_at: null, is_tax_group: false } });
    if (!tax) throw new NotFoundException('Tax rate not found');
    const updated = await db.tax_rates.update({
      where: { id },
      data: { name: dto.name, amount: dto.amount, for_tax_group: dto.forTaxGroup ?? false, updated_at: new Date() },
    });
    // Groups that contain this tax must follow its new amount.
    const groups = await this.prisma.$queryRaw<{ group_tax_id: bigint }[]>`SELECT DISTINCT group_tax_id FROM group_sub_taxes WHERE tax_id = ${id}`;
    for (const g of groups) await this.recalculateGroup(user, Number(g.group_tax_id));
    return updated;
  }

  async remove(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const tax = await db.tax_rates.findFirst({ where: { id, deleted_at: null, is_tax_group: false } });
    if (!tax) throw new NotFoundException('Tax rate not found');
    // Only groups that still exist block the deletion (deleted groups keep their member rows, as in Laravel).
    const inGroups = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM group_sub_taxes g JOIN tax_rates grp ON grp.id = g.group_tax_id
      WHERE g.tax_id = ${id} AND grp.deleted_at IS NULL`;
    if (Number(inGroups[0]?.n ?? 0) > 0) throw new BadRequestException('This tax is part of a tax group and cannot be deleted');
    await db.tax_rates.update({ where: { id }, data: { deleted_at: new Date() } });
    return { success: true };
  }

  async createGroup(user: AuthUser, dto: TaxGroupDto) {
    const subTaxes = await this.loadSubTaxes(user, dto.taxIds);
    assertValidGroup(subTaxes, dto.taxIds);
    const now = new Date();
    const group = await this.prisma.forTenant(user.businessId).tax_rates.create({
      data: {
        business_id: user.businessId,
        name: dto.name,
        amount: groupTaxAmount(subTaxes.map((t) => t.amount)),
        is_tax_group: true,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });
    await this.setMembers(group.id, dto.taxIds);
    return group;
  }

  async updateGroup(user: AuthUser, id: number, dto: TaxGroupDto) {
    const db = this.prisma.forTenant(user.businessId);
    const group = await db.tax_rates.findFirst({ where: { id, deleted_at: null, is_tax_group: true } });
    if (!group) throw new NotFoundException('Tax group not found');
    const subTaxes = await this.loadSubTaxes(user, dto.taxIds);
    assertValidGroup(subTaxes, dto.taxIds);
    const updated = await db.tax_rates.update({
      where: { id },
      data: { name: dto.name, amount: groupTaxAmount(subTaxes.map((t) => t.amount)), updated_at: new Date() },
    });
    await this.setMembers(id, dto.taxIds);
    return updated;
  }

  async removeGroup(user: AuthUser, id: number) {
    const db = this.prisma.forTenant(user.businessId);
    const group = await db.tax_rates.findFirst({ where: { id, deleted_at: null, is_tax_group: true } });
    if (!group) throw new NotFoundException('Tax group not found');
    await db.tax_rates.update({ where: { id }, data: { deleted_at: new Date() } });
    return { success: true };
  }

  private loadSubTaxes(user: AuthUser, ids: number[]) {
    return this.prisma.forTenant(user.businessId).tax_rates.findMany({ where: { id: { in: ids }, deleted_at: null } });
  }

  private async setMembers(groupId: number, taxIds: number[]) {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`DELETE FROM group_sub_taxes WHERE group_tax_id = ${groupId}`,
      ...taxIds.map((t) => this.prisma.$executeRaw`INSERT INTO group_sub_taxes (group_tax_id, tax_id) VALUES (${groupId}, ${t})`),
    ]);
  }

  private async recalculateGroup(user: AuthUser, groupId: number) {
    const members = await this.prisma.$queryRaw<{ amount: number }[]>`
      SELECT t.amount FROM group_sub_taxes g JOIN tax_rates t ON t.id = g.tax_id WHERE g.group_tax_id = ${groupId} AND t.deleted_at IS NULL`;
    await this.prisma.forTenant(user.businessId).tax_rates.update({
      where: { id: groupId },
      data: { amount: groupTaxAmount(members.map((m) => Number(m.amount))), updated_at: new Date() },
    });
  }
}
