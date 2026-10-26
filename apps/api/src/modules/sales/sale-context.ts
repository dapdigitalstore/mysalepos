import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantTx } from '../../common/tenant-db';
import type { AuthUser } from '../../common/types';
import { instantToWallClock } from '../../common/time';
import { parseEnabledModules, parsePosSettings, posFlag, roundingMultipleOf } from './sale.rules';

/** Business level settings a sale operation depends on, loaded once per request. */
export interface BusinessCtx {
  id: number;
  timeZone: string;
  currencyPrecision: number;
  quantityPrecision: number;
  accountingMethod: 'fifo' | 'lifo';
  salesCmsnAgnt: string | null;
  enableInlineTax: boolean;
  enableRp: boolean;
  enableSubUnits: boolean;
  enableProductExpiry: boolean;
  onProductExpiry: string;
  stopSellingBefore: number;
  transactionEditDays: number;
  refNoPrefixes: string | null;
  modules: string[];
  posSettings: Record<string, unknown>;
  allowOverselling: boolean;
  roundingMultiple: Prisma.Decimal;
  rp: {
    enableRp: boolean;
    minOrderTotalForRp: Prisma.Decimal;
    amountForUnitRp: Prisma.Decimal;
    maxRpPerOrder: number | null;
    redeemAmountPerUnitRp: Prisma.Decimal;
    minRedeemPoint: number | null;
    maxRedeemPoint: number | null;
  };
}

export async function loadBusinessCtx(tx: TenantTx, user: AuthUser): Promise<BusinessCtx> {
  const b = await tx.business.findUnique({ where: { id: user.businessId } });
  if (!b) throw new NotFoundException('Business not found');
  const posSettings = parsePosSettings(b.pos_settings);
  return {
    id: b.id,
    timeZone: user.timeZone || b.time_zone,
    currencyPrecision: b.currency_precision,
    quantityPrecision: b.quantity_precision,
    accountingMethod: b.accounting_method === 'lifo' ? 'lifo' : 'fifo',
    salesCmsnAgnt: b.sales_cmsn_agnt ?? null,
    enableInlineTax: b.enable_inline_tax,
    enableRp: b.enable_rp,
    enableSubUnits: b.enable_sub_units,
    enableProductExpiry: b.enable_product_expiry,
    onProductExpiry: b.on_product_expiry,
    stopSellingBefore: b.stop_selling_before,
    transactionEditDays: b.transaction_edit_days,
    refNoPrefixes: b.ref_no_prefixes,
    modules: parseEnabledModules(b.enabled_modules),
    posSettings,
    allowOverselling: posFlag(posSettings, 'allow_overselling'),
    roundingMultiple: roundingMultipleOf(posSettings),
    rp: {
      enableRp: b.enable_rp,
      minOrderTotalForRp: b.min_order_total_for_rp,
      amountForUnitRp: b.amount_for_unit_rp,
      maxRpPerOrder: b.max_rp_per_order,
      redeemAmountPerUnitRp: b.redeem_amount_per_unit_rp,
      minRedeemPoint: b.min_redeem_point,
      maxRedeemPoint: b.max_redeem_point,
    },
  };
}

/** The expiry cut-off day (YYYY-MM-DD, business local date) when the business stops selling expired stock; otherwise null. */
export function stopSellingCutoffDay(biz: BusinessCtx, now = new Date()): string | null {
  if (!biz.enableProductExpiry || biz.onProductExpiry !== 'stop_selling') return null;
  const local = instantToWallClock(now, biz.timeZone);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + biz.stopSellingBefore));
  return d.toISOString().slice(0, 10);
}

export const toDecimal = (v: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal => new Prisma.Decimal(v ?? 0);

/** Shown name of a sell line's product, e.g. "T-shirt (Size: M)" for variable products. */
export function productLabel(name: string, variationName: string | null | undefined, isDummy: boolean, subSku: string | null | undefined): string {
  const base = !isDummy && variationName ? `${name} (${variationName})` : name;
  return subSku ? `${base} SKU: ${subSku}` : base;
}
