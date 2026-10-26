import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can } from '../../common/can';
import type { TenantTx } from '../../common/tenant-db';
import type { AuthUser } from '../../common/types';
import type { SaleDto, SaleLineDto } from './sale.dto';
import { productLabel, type BusinessCtx } from './sale-context';
import {
  calculateInvoiceTotals,
  calculateLine,
  comboChildLines,
  creditLimitExceeded,
  dec,
  expectedUnitPriceExcTax,
  groupPriceFor,
  hasShippingData,
  isGiven,
  isWholeNumber,
  linePermissions,
  parseComboComponents,
  parseIdList,
  priceChangeAllowed,
  resolveStatus,
  rewardPointsEarned,
  roundTo,
  totalPaid,
  unitMultiplier,
  ZERO,
  type InvoiceTotals,
  type LineResult,
  type ResolvedStatus,
} from './sale.rules';

type Dec = Prisma.Decimal;
export type VariationRow = Prisma.variationsGetPayload<{ include: { products: true } }>;
export type ContactRow = Prisma.contactsGetPayload<object>;
export type ExistingLine = Prisma.transaction_sell_linesGetPayload<object>;

export interface PreparedChild {
  productId: number;
  variationId: number;
  enableStock: boolean;
  quantity: Dec;
  unitPrice: Dec;
  label: string;
}

export interface PreparedLine {
  existing: ExistingLine | null;
  dto: SaleLineDto;
  variation: VariationRow;
  multiplier: Dec;
  taxId: number | null;
  calc: LineResult;
  label: string;
  enableStock: boolean;
  children: PreparedChild[];
}

export interface PreparedSale {
  status: ResolvedStatus;
  lines: PreparedLine[];
  totals: InvoiceTotals;
  orderTaxId: number | null;
  contact: ContactRow;
  customerGroupId: number | null;
  rpEarned: number;
  rpRedeemed: number;
  rpRedeemedAmount: Dec;
  additional: Array<{ key: string | null; value: Dec }>;
  packingCharge: Dec;
  packingChargeType: 'fixed' | 'percent' | null;
  typesOfServiceId: number | null;
  payTermNumber: number | null;
  payTermType: 'days' | 'months' | null;
  commissionAgent: number | null;
  exchangeRate: Dec;
  /** Sum of the payments sent with the sale (change given back subtracted), 0 for credit sales. */
  paymentsTotal: Dec;
}

export interface PrepareInput {
  tx: TenantTx;
  user: AuthUser;
  biz: BusinessCtx;
  dto: SaleDto;
  isDirectSale: boolean;
  /** The sale being edited, with the stored values the permission checks compare against. */
  existing: {
    id: number;
    discount_type: string | null;
    discount_amount: Dec | null;
    shipping_charges: Dec;
    shipping_details: string | null;
    shipping_address: string | null;
    shipping_status: string | null;
    delivered_to: string | null;
    delivery_person: bigint | null;
    final_total: Dec;
    contact_id: number | null;
    status: string;
    rp_earned: number;
    rp_redeemed: number;
  } | null;
  existingLines: ExistingLine[];
}

const num = (v: unknown): Dec => dec(v as string | number | null | undefined);

/**
 * Turns a posted sale into everything the database needs: validated lines with their server side prices, the invoice
 * totals, the customer, reward points and the credit limit decision. Laravel computes these in the browser and trusts them;
 * here the server computes them (same formulas), so a tampered request cannot change prices or totals.
 */
export async function prepareSale(input: PrepareInput): Promise<PreparedSale> {
  const { tx, user, biz, dto, existing } = input;
  const status = resolveStatus(dto.status);
  const screen = input.isDirectSale ? 'direct' : 'pos';

  // --- customer
  const contact = await tx.contacts.findFirst({ where: { id: dto.contactId, deleted_at: null } });
  if (!contact) throw new BadRequestException('Customer not found');

  // --- lines: products, units, taxes
  const variationIds = [...new Set(dto.lines.map((l) => l.variationId))];
  // deleted variations stay usable on lines that already exist (old sales), but cannot be added
  const variations = await tx.variations.findMany({ where: { id: { in: variationIds } }, include: { products: true } });
  const variationById = new Map(variations.map((v) => [v.id, v]));
  const existingById = new Map(input.existingLines.map((l) => [l.id, l]));

  const unitIds = new Set<number>();
  const taxIds = new Set<number>();
  for (const l of dto.lines) {
    const v = variationById.get(l.variationId);
    if (v?.products.unit_id) unitIds.add(v.products.unit_id);
    if (l.subUnitId) unitIds.add(l.subUnitId);
    if (l.taxId) taxIds.add(l.taxId);
  }
  if (dto.taxRateId) taxIds.add(dto.taxRateId);

  // combo components
  const comboDefs = new Map<number, ReturnType<typeof parseComboComponents>>();
  const componentVariationIds = new Set<number>();
  for (const l of dto.lines) {
    const v = variationById.get(l.variationId);
    if (v?.products.type === 'combo') {
      const defs = parseComboComponents(v.combo_variations);
      comboDefs.set(v.id, defs);
      for (const d of defs) {
        componentVariationIds.add(d.variationId);
        if (d.unitId) unitIds.add(d.unitId);
      }
    }
  }
  const components = componentVariationIds.size
    ? await tx.variations.findMany({ where: { id: { in: [...componentVariationIds] }, deleted_at: null }, include: { products: true } })
    : [];
  const componentById = new Map(components.map((v) => [v.id, v]));
  for (const c of components) if (c.products.unit_id) unitIds.add(c.products.unit_id);

  const units = unitIds.size ? await tx.units.findMany({ where: { id: { in: [...unitIds] } } }) : [];
  const unitById = new Map(units.map((u) => [u.id, u]));
  const taxes = taxIds.size ? await tx.tax_rates.findMany({ where: { id: { in: [...taxIds] } } }) : [];
  const taxById = new Map(taxes.map((t) => [t.id, new Prisma.Decimal(String(t.amount))]));
  for (const id of taxIds) if (!taxById.has(id)) throw new BadRequestException(`Tax rate ${id} not found`);

  // --- price context for the price permission check
  const priceGroupId = dto.sellingPriceGroupId ?? null;
  let groupPrices = new Map<number, { price_type: string; price_inc_tax: Dec }>();
  if (priceGroupId) {
    const group = await tx.selling_price_groups.findFirst({ where: { id: priceGroupId, deleted_at: null }, select: { id: true } });
    if (!group) throw new BadRequestException('Selling price group not found');
    const rows = await tx.variation_group_prices.findMany({ where: { price_group_id: priceGroupId, variation_id: { in: variationIds } } });
    groupPrices = new Map(rows.map((r) => [r.variation_id, { price_type: r.price_type, price_inc_tax: r.price_inc_tax }]));
  }
  let customerGroupId: number | null = null;
  let customerGroupPercent: Dec = ZERO;
  if (contact.customer_group_id) {
    const cg = await tx.customer_groups.findFirst({ where: { id: contact.customer_group_id } });
    if (cg) {
      customerGroupId = cg.id;
      if (cg.price_calculation_type === 'percentage' && cg.amount) customerGroupPercent = new Prisma.Decimal(String(cg.amount));
    }
  }

  const perms = linePermissions(screen);
  const canEditPrice = can(user, perms.price);
  const canEditDiscount = can(user, perms.discount);

  const lines: PreparedLine[] = [];
  for (const l of dto.lines) {
    const variation = variationById.get(l.variationId);
    if (!variation || variation.product_id !== l.productId || variation.products.business_id !== user.businessId) {
      throw new BadRequestException(`Product ${l.productId} / variation ${l.variationId} not found`);
    }
    const product = variation.products;
    const existingLine = l.id ? existingById.get(l.id) ?? null : null;
    if (variation.deleted_at && !existingLine) throw new BadRequestException(`Product ${l.productId} is no longer available`);
    if (l.id && !existingLine) throw new BadRequestException(`Sell line ${l.id} does not belong to this sale`);
    if (existingLine && (existingLine.variation_id !== l.variationId || existingLine.product_id !== l.productId)) {
      throw new BadRequestException('The product of an existing sale line cannot be changed');
    }

    const quantity = num(l.quantity);
    if (quantity.lte(0)) throw new BadRequestException('Quantity must be greater than 0');
    const unitPrice = num(l.unitPrice);
    if (unitPrice.isNegative()) throw new BadRequestException('Unit price cannot be negative');

    // unit and multiplier
    const ownUnit = product.unit_id ? unitById.get(product.unit_id) ?? null : null;
    let saleUnit = ownUnit;
    let multiplier = new Prisma.Decimal(1);
    const subUnitId = l.subUnitId && l.subUnitId !== product.unit_id ? l.subUnitId : null;
    if (subUnitId) {
      const sub = unitById.get(subUnitId);
      const allowed = parseIdList(product.sub_unit_ids);
      if (!sub || sub.base_unit_id !== product.unit_id || (allowed.length > 0 && !allowed.includes(subUnitId))) {
        throw new BadRequestException(`Unit ${subUnitId} cannot be used for ${product.name}`);
      }
      saleUnit = sub;
      multiplier = unitMultiplier(product.unit_id, subUnitId, sub.base_unit_multiplier);
    }
    if (saleUnit && !saleUnit.allow_decimal && !isWholeNumber(quantity)) {
      throw new BadRequestException(`${product.name}: quantity must be a whole number for unit ${saleUnit.short_name}`);
    }

    // tax is only used when the business shows inline tax
    const taxId = biz.enableInlineTax && l.taxId ? l.taxId : null;
    const discountType = l.lineDiscountType ?? null;
    const discountAmount = num(l.lineDiscountAmount);
    if (discountAmount.isNegative()) throw new BadRequestException('Discount cannot be negative');

    // permissions: only changed values are checked, so editing an old sale never trips on its stored values
    const label = productLabel(product.name, variation.name, product.type !== 'variable', variation.sub_sku);
    const hasDiscount = !!discountType && !discountAmount.isZero();
    const sameDiscount =
      !!existingLine && (existingLine.line_discount_type ?? null) === discountType && num(existingLine.line_discount_amount).mul(discountType === 'fixed' ? multiplier : 1).eq(discountAmount);
    if (hasDiscount && !canEditDiscount && !sameDiscount) throw new ForbiddenException(`You cannot give a discount on ${product.name}`);
    if (!canEditPrice) {
      const stored = existingLine ? num(existingLine.unit_price_before_discount).mul(multiplier) : null;
      const sameAsStored = stored !== null && roundTo(stored, biz.currencyPrecision).eq(roundTo(unitPrice, biz.currencyPrecision));
      if (!sameAsStored) {
        const gp = groupPrices.get(variation.id);
        const groupExc = gp ? groupPriceFor(gp.price_type, gp.price_inc_tax, variation.sell_price_inc_tax, taxById.get(product.tax ?? 0) ?? ZERO).excTax : null;
        const expected = expectedUnitPriceExcTax(variation.default_sell_price, groupExc, customerGroupPercent).mul(multiplier);
        if (!priceChangeAllowed(false, unitPrice, expected, biz.currencyPrecision)) throw new ForbiddenException(`You cannot change the price of ${product.name}`);
      }
    }

    const calc = calculateLine(
      { quantity, unitPrice, discountType, discountAmount, taxRate: taxId ? taxById.get(taxId) : null, multiplier },
      biz.currencyPrecision,
    );

    // combo: component lines priced from the combo line
    const children: PreparedChild[] = [];
    if (product.type === 'combo') {
      const defs = comboDefs.get(variation.id) ?? [];
      const comps = defs.map((d) => {
        const cv = componentById.get(d.variationId);
        if (!cv) throw new BadRequestException(`A component of ${product.name} no longer exists`);
        const cu = d.unitId ? unitById.get(d.unitId) : undefined;
        const cm = cu && cu.base_unit_id === cv.products.unit_id ? unitMultiplier(cv.products.unit_id, d.unitId, cu.base_unit_multiplier) : new Prisma.Decimal(1);
        return { cv, quantity: d.quantity.mul(cm).mul(calc.stored.quantity) };
      });
      const priced = comboChildLines(
        comps.map((c) => ({ productId: c.cv.product_id, variationId: c.cv.id, quantity: c.quantity, sellPriceIncTax: dec(c.cv.sell_price_inc_tax) })),
        calc.stored.unit_price_inc_tax,
        calc.stored.quantity,
      );
      priced.forEach((p, i) => {
        const cv = comps[i].cv;
        children.push({
          productId: p.productId,
          variationId: p.variationId,
          enableStock: cv.products.enable_stock,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          label: productLabel(cv.products.name, cv.name, cv.products.type !== 'variable', cv.sub_sku),
        });
      });
    }

    lines.push({ existing: existingLine, dto: l, variation, multiplier, taxId, calc, label, enableStock: product.enable_stock, children });
  }

  // --- invoice level discount / shipping permissions (only changed values are checked)
  const discountType = dto.discountType ?? null;
  const discountAmount = num(dto.discountAmount);
  if (discountAmount.isNegative()) throw new BadRequestException('Discount cannot be negative');
  const sameInvoiceDiscount = !!existing && (existing.discount_type ?? null) === discountType && num(existing.discount_amount).eq(discountAmount);
  if (!discountAmount.isZero() && !can(user, 'discount.access') && !sameInvoiceDiscount) throw new ForbiddenException('You cannot give a discount');

  const sameShipping =
    !!existing &&
    num(existing.shipping_charges).eq(num(dto.shippingCharges)) &&
    (existing.shipping_details ?? '') === (dto.shippingDetails ?? '') &&
    (existing.shipping_address ?? '') === (dto.shippingAddress ?? '') &&
    (existing.shipping_status ?? '') === (dto.shippingStatus ?? '') &&
    (existing.delivered_to ?? '') === (dto.deliveredTo ?? '') &&
    (existing.delivery_person === null ? null : Number(existing.delivery_person)) === (dto.deliveryPerson ?? null);
  if (hasShippingData(dto) && !can(user, 'access_shipping') && !sameShipping) throw new ForbiddenException('You cannot add shipping details');
  if (num(dto.shippingCharges).isNegative()) throw new BadRequestException('Shipping charges cannot be negative');

  // --- types of service (packing charge)
  const servicesOn = biz.modules.includes('types_of_service');
  const packingChargeType = servicesOn && dto.packingChargeType ? dto.packingChargeType : null;
  const packingCharge = servicesOn ? num(dto.packingCharge) : ZERO;
  const typesOfServiceId = servicesOn ? dto.typesOfServiceId ?? null : null;

  const additional = (dto.additionalExpenses ?? []).map((a) => ({ key: a.key.trim() === '' ? null : a.key.trim(), value: num(a.value) }));

  // --- reward points
  let rpRedeemed = 0;
  let rpRedeemedAmount = ZERO;
  if (biz.enableRp && !status.isQuotation && (dto.rpRedeemed ?? 0) > 0 && !contact.is_default) {
    rpRedeemed = dto.rpRedeemed ?? 0;
    const alreadyRedeemed = existing && existing.contact_id === contact.id ? existing.rp_redeemed : 0;
    if (rpRedeemed > contact.total_rp + alreadyRedeemed) throw new BadRequestException('The customer does not have that many reward points');
    if (biz.rp.minRedeemPoint && rpRedeemed < biz.rp.minRedeemPoint) throw new BadRequestException(`At least ${biz.rp.minRedeemPoint} reward points must be redeemed`);
    if (biz.rp.maxRedeemPoint && rpRedeemed > biz.rp.maxRedeemPoint) throw new BadRequestException(`At most ${biz.rp.maxRedeemPoint} reward points can be redeemed`);
    const value = biz.rp.redeemAmountPerUnitRp.mul(rpRedeemed);
    rpRedeemedAmount = isGiven(dto.rpRedeemedAmount) ? Prisma.Decimal.min(num(dto.rpRedeemedAmount), value) : value;
  }

  const orderTaxRate = dto.taxRateId ? taxById.get(dto.taxRateId) ?? null : null;
  const totals = calculateInvoiceTotals({
    lineTotals: lines.map((l) => l.calc.lineTotal),
    discountType,
    discountAmount,
    taxRate: orderTaxRate,
    shippingCharges: dto.shippingCharges,
    additionalExpenses: additional.map((a) => a.value),
    packingCharge,
    packingChargeType,
    rpRedeemedAmount,
    roundingMultiple: biz.roundingMultiple,
    precision: biz.currencyPrecision,
  });
  if (totals.finalTotal.isNegative()) throw new BadRequestException('The sale total cannot be negative');

  const rpEarned =
    status.status === 'final'
      ? rewardPointsEarned(totals.finalTotal, {
          enableRp: biz.rp.enableRp,
          minOrderTotalForRp: biz.rp.minOrderTotalForRp,
          amountForUnitRp: biz.rp.amountForUnitRp,
          maxRpPerOrder: biz.rp.maxRpPerOrder,
        })
      : 0;

  // --- payments total (credit limit)
  let paymentsTotal = ZERO;
  if (!dto.isCreditSale && !dto.isSuspend) {
    paymentsTotal = totalPaid([...(dto.payments ?? []).map((p) => ({ amount: p.amount })), { amount: dto.changeReturn ?? 0, isReturn: true }]);
    if (paymentsTotal.isNegative()) paymentsTotal = ZERO;
  }

  // --- credit limit (final sales only)
  if (status.status === 'final') {
    await assertCreditLimit(tx, user.businessId, contact, totals.finalTotal, paymentsTotal, existing?.id ?? null, biz.currencyPrecision);
  }

  // --- commission agent
  let commissionAgent = dto.commissionAgentId ?? null;
  if (biz.salesCmsnAgnt === 'logged_in_user') commissionAgent = user.id;
  if (commissionAgent) {
    const agent = await tx.users.findFirst({ where: { id: commissionAgent, business_id: user.businessId, deleted_at: null }, select: { id: true } });
    if (!agent) throw new BadRequestException('Commission agent not found');
  }

  // --- pay term falls back to the customer's
  const payTermNumber = dto.payTermNumber && dto.payTermType ? dto.payTermNumber : contact.pay_term_number ?? null;
  const payTermType = dto.payTermNumber && dto.payTermType ? dto.payTermType : contact.pay_term_type ?? null;

  const exchange = num(dto.exchangeRate);
  return {
    status,
    lines,
    totals,
    orderTaxId: dto.taxRateId ?? null,
    contact,
    customerGroupId,
    rpEarned,
    rpRedeemed,
    rpRedeemedAmount,
    additional,
    packingCharge,
    packingChargeType,
    typesOfServiceId,
    payTermNumber,
    payTermType,
    commissionAgent,
    exchangeRate: exchange.isZero() ? new Prisma.Decimal(1) : exchange,
    paymentsTotal,
  };
}


/** `isCustomerCreditLimitExeeded` for a final sale: refuses with CREDIT_LIMIT_EXCEEDED when the customer's open balance plus this sale's due is above the limit. */
export async function assertCreditLimit(
  tx: TenantTx,
  businessId: number,
  contact: Pick<ContactRow, 'id' | 'credit_limit'>,
  finalTotal: Dec,
  paymentsTotal: Dec,
  excludeSaleId: number | null,
  precision: number,
): Promise<void> {
  if (contact.credit_limit === null) return;
  const others = await tx.$queryRaw<Array<{ total_invoice: Dec | string | null; invoice_paid: Dec | string | null }>>`
    SELECT COALESCE(SUM(t.final_total), 0) AS total_invoice,
           COALESCE(SUM((SELECT SUM(IF(tp.is_return = 1, -1 * tp.amount, tp.amount)) FROM transaction_payments tp WHERE tp.transaction_id = t.id)), 0) AS invoice_paid
    FROM transactions t
    WHERE t.business_id = ${businessId} AND t.contact_id = ${contact.id} AND t.type = 'sell' AND t.status = 'final'
      ${excludeSaleId ? Prisma.sql`AND t.id <> ${excludeSaleId}` : Prisma.empty}`;
  const exceeded = creditLimitExceeded({
    status: 'final',
    finalTotal,
    currentPayments: paymentsTotal,
    creditLimit: contact.credit_limit,
    otherInvoiceTotal: others[0]?.total_invoice ?? 0,
    otherInvoicePaid: others[0]?.invoice_paid ?? 0,
  });
  if (exceeded !== false) {
    throw new BadRequestException({ message: `The customer's credit limit of ${exceeded.toFixed(precision)} would be exceeded`, code: 'CREDIT_LIMIT_EXCEEDED' });
  }
}
