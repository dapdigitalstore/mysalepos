/** Operations whose `where` can be narrowed with an extra business_id filter. */
const WHERE_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

type Args = { where?: Record<string, unknown>; data?: unknown; create?: unknown } & Record<string, unknown>;

/**
 * Forces every query on a tenant table to the caller's business. Pure so it can be unit tested;
 * PrismaService.forTenant() applies it to all models that have a business_id column.
 */
export function applyTenantScope(operation: string, args: Args | undefined, businessId: number): Args {
  const next: Args = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) {
    next.where = { ...(next.where ?? {}), business_id: businessId };
  }
  if (operation === 'create') {
    next.data = { ...(next.data as object), business_id: businessId };
  }
  if (operation === 'createMany') {
    const rows = Array.isArray(next.data) ? next.data : [next.data];
    next.data = rows.map((r) => ({ ...(r as object), business_id: businessId }));
  }
  if (operation === 'upsert') {
    next.create = { ...(next.create as object), business_id: businessId };
  }
  return next;
}
