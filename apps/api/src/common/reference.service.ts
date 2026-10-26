import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatReferenceNumber, prefixFor } from './reference-number';

/**
 * Atomic per-business counters (table `reference_counts`), shared with Laravel. The row is locked
 * with SELECT ... FOR UPDATE so two requests can never receive the same number.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Next number for `type` (e.g. 'contacts', 'business_location', 'purchase'). `defaultPrefix` overrides the business prefix. */
  async next(businessId: number, type: string, defaultPrefix?: string): Promise<{ count: number; number: string }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: number; ref_count: number }[]>`
        SELECT id, ref_count FROM reference_counts WHERE ref_type = ${type} AND business_id = ${businessId} FOR UPDATE`;
      let count: number;
      if (rows.length > 0) {
        count = rows[0].ref_count + 1;
        await tx.$executeRaw`UPDATE reference_counts SET ref_count = ${count}, updated_at = NOW() WHERE id = ${rows[0].id}`;
      } else {
        count = 1;
        await tx.$executeRaw`INSERT INTO reference_counts (ref_type, ref_count, business_id, created_at, updated_at) VALUES (${type}, 1, ${businessId}, NOW(), NOW())`;
      }
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { ref_no_prefixes: true } });
      const prefix = defaultPrefix ?? prefixFor(business?.ref_no_prefixes, type);
      return { count, number: formatReferenceNumber(type, count, prefix, new Date().getFullYear()) };
    });
  }
}

@Global()
@Module({ providers: [ReferenceService], exports: [ReferenceService] })
export class ReferenceModule {}
