import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import type { AuthUser } from '../../common/types';
import { instantToWallClock } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { permittedLocationIds } from '../settings/locations/location-access';
import { CloseRegisterDto, OpenRegisterDto, RegisterListQueryDto } from './cash-register.dto';
import {
  assertCanAccessRegister,
  assertRegisterOpen,
  computeRegisterTotals,
  configuredDenominations,
  creditSales,
  customPaymentLabels,
  dayRangeInstants,
  denominationsTotal,
  floorToMinute,
  money,
  parseDenominations,
  pickRegisterLocation,
  reportRowTotals,
  shiftGrandTotal,
  userDisplayName,
  validateCloseInput,
  validateInitialAmount,
  visiblePaymentTypes,
  type RowGroup,
} from './cash-register.rules';

const SORTABLE = ['created_at', 'closed_at', 'status', 'id', 'closing_amount'] as const;

type Dec = Prisma.Decimal | null;
const dec = (v: Dec | undefined): Prisma.Decimal => new Prisma.Decimal(v ?? 0);

interface ShiftTotalsRow {
  total_tax: Dec;
  total_discount: Dec;
  total_sales: Dec;
  total_shipping_charges: Dec;
}
interface ProductRow {
  sku: string | null;
  product_name: string;
  product_type: string;
  variation_name: string | null;
  product_variation_name: string | null;
  total_quantity: Dec;
  total_amount: Dec;
}
interface BrandRow {
  brand_name: string | null;
  total_quantity: Dec;
  total_amount: Dec;
}
interface ServiceRow {
  types_of_service_name: string | null;
  total_sales: Dec;
}

/** Open / current / details / close / report of cash registers (the screens). The payment hooks for sales are in CashRegisterService. */
@Injectable()
export class RegistersService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ current register

  /** The signed-in user's open register, if any. Cheap enough to call on every POS screen. */
  async current(user: AuthUser) {
    const db = this.prisma.forTenant(user.businessId);
    const register = await db.cash_registers.findFirst({ where: { user_id: user.id, status: 'open' }, orderBy: { id: 'asc' } });
    if (!register) return { open: false, register: null };
    const [initial, location] = await Promise.all([
      db.cash_register_transactions.aggregate({ where: { cash_register_id: register.id, transaction_type: 'initial' }, _sum: { amount: true } }),
      register.location_id ? db.business_locations.findFirst({ where: { id: register.location_id }, select: { name: true } }) : null,
    ]);
    return {
      open: true,
      register: {
        id: register.id,
        locationId: register.location_id,
        locationName: location?.name ?? null,
        openedAt: register.created_at,
        cashInHand: money(initial._sum.amount),
      },
      timeZone: user.timeZone,
    };
  }

  // ------------------------------------------------------------------ open

  /** Laravel CashRegisterController@store, plus: one open register per user and a location the user may use. */
  async open(user: AuthUser, dto: OpenRegisterDto) {
    const db = this.prisma.forTenant(user.businessId);
    const amount = validateInitialAmount(dto.amount);
    const permitted = permittedLocationIds(user);
    const locations = await db.business_locations.findMany({
      where: { deleted_at: null, is_active: true, ...(permitted === 'all' ? {} : { id: { in: permitted } }) },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const locationId = pickRegisterLocation(dto.locationId, locations.map((l) => l.id));

    const register = await db.$transaction(async (tx) => {
      // Two tabs opening a register at the same moment must not both succeed: serialise on the user's row.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const existing = await tx.cash_registers.findFirst({ where: { user_id: user.id, status: 'open' }, select: { id: true } });
      if (existing) throw new ConflictException('You already have an open cash register');

      const now = new Date();
      const created = await tx.cash_registers.create({
        data: { business_id: user.businessId, user_id: user.id, status: 'open', location_id: locationId, created_at: floorToMinute(now), updated_at: now },
      });
      if (amount.gt(0)) {
        await tx.cash_register_transactions.create({
          data: { cash_register_id: created.id, amount, pay_method: 'cash', type: 'credit', transaction_type: 'initial', created_at: now, updated_at: now },
        });
      }
      return created;
    });
    return { id: register.id, locationId, openedAt: register.created_at, cashInHand: money(amount) };
  }

  // ------------------------------------------------------------------ details

  /** `id` undefined = the user's open register (Laravel getRegisterDetails()), otherwise that register (show / getCloseRegister). */
  async details(user: AuthUser, id?: number) {
    const db = this.prisma.forTenant(user.businessId);
    const register = await this.load(user, id);
    const tz = user.timeZone;

    const [groups, cashier, location, business] = await Promise.all([
      this.groupRows(user, register.id),
      register.user_id ? db.users.findFirst({ where: { id: register.user_id }, select: { surname: true, first_name: true, last_name: true, email: true } }) : null,
      register.location_id ? db.business_locations.findFirst({ where: { id: register.location_id }, select: { id: true, name: true, default_payment_accounts: true } }) : null,
      this.prisma.business.findUnique({ where: { id: user.businessId }, select: { pos_settings: true, enabled_modules: true, custom_labels: true } }),
    ]);

    const totals = computeRegisterTotals(groups);
    const closeTime = register.closed_at ?? new Date();
    const typesOfServiceOn = parseList(business?.enabled_modules).includes('types_of_service');
    const shift = register.user_id
      ? await this.shiftDetails(user, register.user_id, register.created_at ?? closeTime, closeTime, typesOfServiceOn)
      : emptyShift(typesOfServiceOn);

    const labels = customPaymentLabels(business?.custom_labels);
    const visible = visiblePaymentTypes(labels, location?.default_payment_accounts, location !== null);
    const used = new Set(totals.methods.filter((m) => !m.sale.isZero() || !m.expense.isZero() || !m.refund.isZero()).map((m) => m.method));
    const paymentTypes = [...visible];
    // A custom method switched off since the shift still shows when it carried money.
    for (const m of used) {
      if (!paymentTypes.some((p) => p.method === m)) paymentTypes.push({ method: m, label: labels[m] ?? null });
    }

    const denominationRows = parseDenominations(register.denominations);
    const productAmounts = shift.products.map((p) => p.amount);
    const brandAmounts = shift.brands.map((p) => p.amount);
    const posSettings = parseObject(business?.pos_settings);

    return {
      register: {
        id: register.id,
        status: register.status,
        openedAt: register.created_at,
        closedAt: register.closed_at,
        userId: register.user_id,
        userName: cashier ? userDisplayName(cashier) : '',
        email: cashier?.email ?? null,
        locationId: register.location_id,
        locationName: location?.name ?? null,
        closingAmount: money(register.closing_amount),
        totalCardSlips: register.total_card_slips,
        totalCheques: register.total_cheques,
        closingNote: register.closing_note,
        denominations: denominationRows,
        denominationsTotal: money(denominationsTotal(denominationRows)),
      },
      closeTime,
      timeZone: tz,
      paymentTypes,
      totals: {
        cashInHand: money(totals.cashInHand),
        totalSale: money(totals.totalSale),
        totalExpense: money(totals.totalExpense),
        totalRefund: money(totals.totalRefund),
        totalPayment: money(totals.totalPayment),
        grossSale: money(totals.grossSale),
        expectedTotal: money(totals.expectedTotal),
        suggestedClosingAmount: money(totals.suggestedClosingAmount),
        cardSlips: totals.cardSlips,
        cheques: totals.cheques,
        /** Sales of the shift (final, non-direct) minus what reached the register. */
        creditSales: money(creditSales(shift.totals.totalSales, totals.totalSale)),
        shiftSales: money(shift.totals.totalSales),
        methods: totals.methods.map((m) => ({ method: m.method, sale: money(m.sale), expense: money(m.expense), refund: money(m.refund) })),
      },
      shift: {
        totalTax: money(shift.totals.totalTax),
        totalDiscount: money(shift.totals.totalDiscount),
        totalShippingCharges: money(shift.totals.totalShipping),
        products: shift.products.map((p) => ({ ...p, amount: money(p.amount), quantity: p.quantity.toFixed() })),
        productsQuantity: shift.products.reduce((a, p) => a.add(p.quantity), new Prisma.Decimal(0)).toFixed(),
        productsGrandTotal: money(shiftGrandTotal(productAmounts, shift.totals.totalTax, shift.totals.totalDiscount, shift.totals.totalShipping)),
        brands: shift.brands.map((b) => ({ ...b, amount: money(b.amount), quantity: b.quantity.toFixed() })),
        brandsQuantity: shift.brands.reduce((a, b) => a.add(b.quantity), new Prisma.Decimal(0)).toFixed(),
        brandsGrandTotal: money(shiftGrandTotal(brandAmounts, shift.totals.totalTax, shift.totals.totalDiscount, shift.totals.totalShipping)),
        typesOfService: shift.typesOfService?.map((s) => ({ name: s.name, total: money(s.total) })) ?? null,
      },
      config: {
        denominations: configuredDenominations(posSettings),
        denominationsOn: typeof posSettings.enable_cash_denomination_on === 'string' ? posSettings.enable_cash_denomination_on : null,
      },
    };
  }

  // ------------------------------------------------------------------ close

  /** Laravel postCloseRegister, for one register (the user's open one when `id` is undefined). */
  async close(user: AuthUser, id: number | undefined, dto: CloseRegisterDto) {
    const db = this.prisma.forTenant(user.businessId);
    const register = await this.load(user, id);
    assertRegisterOpen(register.status);
    const input = validateCloseInput({
      closingAmount: dto.closingAmount,
      totalCardSlips: dto.totalCardSlips,
      totalCheques: dto.totalCheques,
      closingNote: dto.closingNote,
      denominations: dto.denominations,
    });

    const now = new Date();
    // The status check inside the update makes a double click (or two cashiers) close the register once.
    const updated = await db.cash_registers.updateMany({
      where: { id: register.id, status: 'open' },
      data: { ...input, status: 'close', closed_at: now, updated_at: now },
    });
    if (updated.count !== 1) throw new ConflictException('This register was already closed');
    return { id: register.id, status: 'close' as const, closedAt: now };
  }

  // ------------------------------------------------------------------ report

  /** The register report (Laravel ReportController@getRegisterReport / TransactionUtil::registerReport). */
  async list(user: AuthUser, q: RegisterListQueryDto) {
    const db = this.prisma.forTenant(user.businessId);
    const permitted = permittedLocationIds(user);
    const { from, to } = dayRangeInstants(q.startDate, q.endDate, user.timeZone);

    const and: Prisma.cash_registersWhereInput[] = [];
    if (permitted !== 'all') and.push({ location_id: { in: permitted } });
    if (q.locationId) and.push({ location_id: q.locationId });
    if (q.userId) and.push({ user_id: q.userId });
    if (q.status) and.push({ status: q.status });
    if (from) and.push({ created_at: { gte: from } });
    if (to) and.push({ created_at: { lt: to } });
    const term = q.search?.trim();
    if (term) {
      and.push({
        users: { OR: [{ first_name: { contains: term } }, { last_name: { contains: term } }, { surname: { contains: term } }, { username: { contains: term } }, { email: { contains: term } }] },
      });
    }
    const where: Prisma.cash_registersWhereInput = { business_id: user.businessId, AND: and };

    const sort = q.sortBy && (SORTABLE as readonly string[]).includes(q.sortBy) ? orderBy(q, SORTABLE, 'created_at') : { created_at: 'desc' as const };
    const [rows, total, footerGroups] = await Promise.all([
      db.cash_registers.findMany({
        where,
        orderBy: [sort, { id: 'desc' }],
        ...skipTake(q),
        include: { users: { select: { surname: true, first_name: true, last_name: true, email: true } } },
      }),
      db.cash_registers.count({ where }),
      db.cash_register_transactions.groupBy({
        by: ['pay_method', 'transaction_type'],
        where: { cash_registers: where },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const locationIds = [...new Set(rows.map((r) => r.location_id).filter((v): v is number => v !== null))];
    const [pageGroups, locations] = await Promise.all([
      ids.length
        ? db.cash_register_transactions.groupBy({
            by: ['cash_register_id', 'pay_method', 'transaction_type'],
            where: { cash_register_id: { in: ids } },
            _sum: { amount: true },
            _count: { _all: true },
          })
        : [],
      locationIds.length ? db.business_locations.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }) : [],
    ]);
    const locationName = new Map(locations.map((l) => [l.id, l.name]));

    const data = rows.map((r) => {
      const groups: RowGroup[] = pageGroups
        .filter((g) => g.cash_register_id === r.id)
        .map((g) => ({ payMethod: g.pay_method, transactionType: g.transaction_type, amount: dec(g._sum.amount), count: g._count._all }));
      return {
        id: r.id,
        status: r.status,
        openedAt: r.created_at,
        closedAt: r.status === 'close' ? r.closed_at : null,
        userId: r.user_id,
        userName: r.users ? userDisplayName(r.users) : '',
        email: r.users?.email ?? null,
        locationId: r.location_id,
        locationName: r.location_id ? (locationName.get(r.location_id) ?? null) : null,
        closingAmount: money(r.closing_amount),
        totalCardSlips: r.total_card_slips,
        totalCheques: r.total_cheques,
        ...reportRowTotals(groups),
      };
    });

    const footer = reportRowTotals(
      footerGroups.map((g) => ({ payMethod: g.pay_method, transactionType: g.transaction_type, amount: dec(g._sum.amount), count: g._count._all })),
    );
    return {
      ...paginated(data, total, q),
      totals: footer,
      timeZone: user.timeZone,
    };
  }

  // ------------------------------------------------------------------ internals

  /** The register to work on, checked against the user's business and (for other cashiers' registers) locations. */
  private async load(user: AuthUser, id: number | undefined) {
    const db = this.prisma.forTenant(user.businessId);
    if (id === undefined) {
      const mine = await db.cash_registers.findFirst({ where: { user_id: user.id, status: 'open' }, orderBy: { id: 'asc' } });
      if (!mine) throw new NotFoundException('You have no open cash register');
      return mine;
    }
    const register = await db.cash_registers.findFirst({ where: { id } });
    if (!register) throw new NotFoundException('Cash register not found');
    assertCanAccessRegister({ userId: register.user_id, locationId: register.location_id }, user.id, permittedLocationIds(user));
    return register;
  }

  private async groupRows(user: AuthUser, registerId: number): Promise<RowGroup[]> {
    // Only called for a register that was loaded through the tenant-scoped client above.
    const rows = await this.prisma.forTenant(user.businessId).cash_register_transactions.groupBy({
      by: ['pay_method', 'transaction_type'],
      where: { cash_register_id: registerId },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((g) => ({ payMethod: g.pay_method, transactionType: g.transaction_type, amount: dec(g._sum.amount), count: g._count._all }));
  }

  /**
   * Laravel getRegisterTransactionDetails: the cashier's final, non-direct sales created between open and close time,
   * with products (by variation and by brand), tax / discount / shipping totals and, when enabled, types of service.
   * Raw SQL, so the times are converted to the wall-clock values the database holds.
   */
  private async shiftDetails(user: AuthUser, cashierId: number, openTime: Date, closeTime: Date, typesOfServiceOn: boolean) {
    const tz = user.timeZone;
    const from = instantToWallClock(openTime, tz);
    const to = instantToWallClock(closeTime, tz);
    const bid = user.businessId;

    const [brandRows, productRows, totalsRows, serviceRows] = await Promise.all([
      this.prisma.$queryRaw<BrandRow[]>(Prisma.sql`
        SELECT B.name AS brand_name, SUM(TSL.quantity) AS total_quantity, SUM(TSL.unit_price_inc_tax * TSL.quantity) AS total_amount
        FROM transactions t
        JOIN transaction_sell_lines TSL ON t.id = TSL.transaction_id
        JOIN products P ON TSL.product_id = P.id
        LEFT JOIN brands B ON P.brand_id = B.id
        WHERE t.business_id = ${bid} AND t.created_by = ${cashierId} AND t.created_at BETWEEN ${from} AND ${to}
          AND t.type = 'sell' AND t.status = 'final' AND t.is_direct_sale = 0 AND TSL.children_type != 'combo'
        GROUP BY B.id, B.name
        ORDER BY CASE WHEN B.name IS NULL THEN 2 ELSE 1 END, B.name`),
      this.prisma.$queryRaw<ProductRow[]>(Prisma.sql`
        SELECT p.name AS product_name, p.type AS product_type, v.name AS variation_name, pv.name AS product_variation_name, v.sub_sku AS sku,
               SUM(TSL.quantity) AS total_quantity, SUM(TSL.unit_price_inc_tax * TSL.quantity) AS total_amount
        FROM transactions t
        JOIN transaction_sell_lines TSL ON t.id = TSL.transaction_id
        JOIN variations v ON TSL.variation_id = v.id
        JOIN product_variations pv ON v.product_variation_id = pv.id
        JOIN products p ON v.product_id = p.id
        WHERE t.business_id = ${bid} AND t.created_by = ${cashierId} AND t.created_at BETWEEN ${from} AND ${to}
          AND t.type = 'sell' AND t.status = 'final' AND t.is_direct_sale = 0 AND TSL.children_type != 'combo'
        GROUP BY v.id, p.name, p.type, v.name, pv.name, v.sub_sku
        ORDER BY p.name, v.name`),
      this.prisma.$queryRaw<ShiftTotalsRow[]>(Prisma.sql`
        SELECT SUM(tax_amount) AS total_tax,
               SUM(IF(discount_type = 'percentage', total_before_tax * discount_amount / 100, discount_amount)) AS total_discount,
               SUM(final_total) AS total_sales,
               SUM(shipping_charges) AS total_shipping_charges
        FROM transactions
        WHERE business_id = ${bid} AND created_by = ${cashierId} AND created_at BETWEEN ${from} AND ${to}
          AND type = 'sell' AND is_direct_sale = 0 AND status = 'final'`),
      typesOfServiceOn
        ? this.prisma.$queryRaw<ServiceRow[]>(Prisma.sql`
            SELECT tos.name AS types_of_service_name, SUM(t.final_total) AS total_sales
            FROM transactions t
            LEFT JOIN types_of_services tos ON tos.id = t.types_of_service_id
            WHERE t.business_id = ${bid} AND t.created_by = ${cashierId} AND t.transaction_date BETWEEN ${from} AND ${to}
              AND t.is_direct_sale = 0 AND t.type = 'sell' AND t.status = 'final'
            GROUP BY tos.id, tos.name
            ORDER BY total_sales DESC`)
        : Promise.resolve(null),
    ]);

    const t = totalsRows[0];
    return {
      totals: {
        totalTax: dec(t?.total_tax),
        totalDiscount: dec(t?.total_discount),
        totalSales: dec(t?.total_sales),
        totalShipping: dec(t?.total_shipping_charges),
      },
      products: productRows.map((p) => ({
        sku: p.sku,
        productName: p.product_name,
        productType: p.product_type,
        variationName: p.variation_name,
        productVariationName: p.product_variation_name,
        quantity: dec(p.total_quantity),
        amount: dec(p.total_amount),
      })),
      brands: brandRows.map((b) => ({ brandName: b.brand_name, quantity: dec(b.total_quantity), amount: dec(b.total_amount) })),
      typesOfService: serviceRows?.map((s) => ({ name: s.types_of_service_name, total: dec(s.total_sales) })) ?? null,
    };
  }
}

function emptyShift(typesOfServiceOn: boolean) {
  const zero = new Prisma.Decimal(0);
  return {
    totals: { totalTax: zero, totalDiscount: zero, totalSales: zero, totalShipping: zero },
    products: [] as { sku: string | null; productName: string; productType: string; variationName: string | null; productVariationName: string | null; quantity: Prisma.Decimal; amount: Prisma.Decimal }[],
    brands: [] as { brandName: string | null; quantity: Prisma.Decimal; amount: Prisma.Decimal }[],
    typesOfService: typesOfServiceOn ? ([] as { name: string | null; total: Prisma.Decimal }[]) : null,
  };
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
