import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { instantToWallClock, mapDates, wallClockToInstant } from '../common/time';
import { applyTenantScope } from './tenant-scope';

const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'business_id')).map((m) => m.name),
);

/** DATE (no time) columns: never shifted by the time zone conversion, so a birthday stays the same day. */
const DATE_ONLY_FIELDS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.flatMap((m) => m.fields.filter((f) => f.type === 'DateTime' && f.nativeType?.[0] === 'Date').map((f) => f.name)),
);

const TZ_TTL_MS = 5 * 60_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly timeZones = new Map<number, { zone: string; at: number }>();

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Remember a business's time zone (set by the auth layer on every request, and when settings change). */
  setBusinessTimeZone(businessId: number, zone: string) {
    this.timeZones.set(businessId, { zone, at: Date.now() });
  }

  /** The business time zone, cached for a few minutes. Falls back to UTC if the business is unknown. */
  async businessTimeZone(businessId: number): Promise<string> {
    const hit = this.timeZones.get(businessId);
    if (hit && Date.now() - hit.at < TZ_TTL_MS) return hit.zone;
    const business = await this.business.findUnique({ where: { id: businessId }, select: { time_zone: true } });
    const zone = business?.time_zone ?? 'UTC';
    this.setBusinessTimeZone(businessId, zone);
    return zone;
  }

  /**
   * Client for request-scoped data access:
   *  - every table with a business_id column is forced to `businessId`;
   *  - DateTime values are converted between real instants and the naive wall-clock values Laravel keeps
   *    in the database (business time zone), so both apps read and write the same times.
   * Use this, never the raw client, in services. It also works inside `forTenant(id).$transaction(...)`.
   */
  forTenant(businessId: number) {
    const zone = () => this.timeZones.get(businessId)?.zone ?? 'UTC';
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tz = zone();
            // The argument and result types of  are huge unions, so they are handled as unknown here.
            const original = args as unknown;
            const scoped: unknown = TENANT_MODELS.has(model) ? applyTenantScope(operation, original as never, businessId) : original;
            const toDb = mapDates<unknown>(scoped, (d) => instantToWallClock(d, tz), DATE_ONLY_FIELDS);
            const result: unknown = await query(toDb as never);
            return mapDates<unknown>(result, (d) => wallClockToInstant(d, tz), DATE_ONLY_FIELDS) as never;
          },
        },
      },
    });
  }
}
