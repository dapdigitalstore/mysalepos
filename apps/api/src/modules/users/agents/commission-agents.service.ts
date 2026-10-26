import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, users } from '@prisma/client';
import { orderBy, paginated, PageQueryDto, skipTake } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { fullName } from '../users/user.rules';
import { CommissionAgentDto } from './commission-agent.dto';
import { AGENT_DEFAULTS, agentColumns } from './commission-agent.rules';

const SORTABLE = ['first_name', 'email', 'contact_no', 'cmmsn_percent', 'id'] as const;

function view(r: users) {
  return {
    id: r.id,
    surname: r.surname ?? '',
    firstName: r.first_name,
    lastName: r.last_name ?? '',
    fullName: fullName(r),
    email: r.email ?? '',
    contactNo: r.contact_no ?? '',
    address: r.address ?? '',
    cmmsnPercent: r.cmmsn_percent.toFixed(2),
  };
}

@Injectable()
export class CommissionAgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: PageQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const where: Prisma.usersWhereInput = {
      deleted_at: null,
      is_cmmsn_agnt: true,
      ...(q.search
        ? {
            OR: [
              { first_name: { contains: q.search } },
              { last_name: { contains: q.search } },
              { surname: { contains: q.search } },
              { email: { contains: q.search } },
              { contact_no: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.users.findMany({ where, orderBy: orderBy(q, SORTABLE, 'first_name'), ...skipTake(q) }),
      db.users.count({ where }),
    ]);
    return paginated(rows.map(view), total, q);
  }

  /** Dropdown for sales forms (Laravel `User::saleCommissionAgentsDropdown`). */
  async options(user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).users.findMany({
      where: { deleted_at: null, is_cmmsn_agnt: true },
      orderBy: { first_name: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: fullName(r), cmmsnPercent: r.cmmsn_percent.toFixed(2) }));
  }

  async get(user: AuthUser, id: number) {
    return view(await this.find(user.businessId, id));
  }

  async create(user: AuthUser, dto: CommissionAgentDto) {
    const now = new Date();
    const created = await this.prisma.forTenant(user.businessId).users.create({
      data: { ...agentColumns(dto), ...AGENT_DEFAULTS, business_id: user.businessId, status: 'active', created_at: now, updated_at: now },
    });
    return view(created);
  }

  async update(user: AuthUser, id: number, dto: CommissionAgentDto) {
    await this.find(user.businessId, id);
    await this.prisma.forTenant(user.businessId).users.updateMany({
      where: { id, is_cmmsn_agnt: true, deleted_at: null },
      data: { ...agentColumns(dto), updated_at: new Date() },
    });
    return this.get(user, id);
  }

  /** Soft delete. Past sales keep pointing at the agent. */
  async remove(user: AuthUser, id: number) {
    await this.find(user.businessId, id);
    await this.prisma.forTenant(user.businessId).users.updateMany({
      where: { id, is_cmmsn_agnt: true },
      data: { deleted_at: new Date(), updated_at: new Date() },
    });
    return { success: true };
  }

  private async find(businessId: number, id: number): Promise<users> {
    const row = await this.prisma.forTenant(businessId).users.findFirst({ where: { id, is_cmmsn_agnt: true, deleted_at: null } });
    if (!row) throw new NotFoundException('Commission agent not found');
    return row;
  }
}
