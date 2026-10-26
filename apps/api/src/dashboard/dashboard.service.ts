import { Injectable } from '@nestjs/common';
import { startOfMonthInstant } from '../common/time';
import type { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  products: number;
  contacts: number;
  salesThisMonth: { count: number; total: string };
  purchasesThisMonth: { count: number; total: string };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser, now = new Date()): Promise<DashboardSummary> {
    const db = this.prisma.forTenant(user.businessId);
    // "This month" starts at midnight of the 1st in the business time zone.
    const monthStart = startOfMonthInstant(user.timeZone, now);

    const monthTotal = async (type: 'sell' | 'purchase') => {
      const agg = await db.transactions.aggregate({
        where: { type, status: 'final', transaction_date: { gte: monthStart } },
        _sum: { final_total: true },
        _count: { _all: true },
      });
      return { count: agg._count._all, total: (agg._sum.final_total ?? 0).toString() };
    };

    const [products, contacts, salesThisMonth, purchasesThisMonth] = await Promise.all([
      db.products.count(),
      db.contacts.count({ where: { deleted_at: null } }),
      monthTotal('sell'),
      monthTotal('purchase'),
    ]);
    return { products, contacts, salesThisMonth, purchasesThisMonth };
  }
}
