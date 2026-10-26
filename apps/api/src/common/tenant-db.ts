import type { PrismaService } from '../prisma/prisma.service';

/** The client returned by `prisma.forTenant(businessId)`. */
export type TenantDb = ReturnType<PrismaService['forTenant']>;

/**
 * What `db.$transaction(async (tx) => ...)` hands to the callback: the same model API as TenantDb
 * (tenant scoping and time zone conversion included) without the connection/transaction methods.
 * Services that must run inside the caller's transaction take a `TenantTx`.
 */
export type TenantTx = Omit<TenantDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;
