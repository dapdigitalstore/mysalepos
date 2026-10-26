import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../../common/types';
import { isValidTimeZone } from '../../../common/time';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessSettingsDto } from './business-settings.dto';
import { stopSellingBeforeFor, validateEnabledModules, validateRefPrefixes } from './business-settings.rules';

@Injectable()
export class BusinessSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    const b = await this.prisma.business.findUnique({ where: { id: user.businessId } });
    if (!b) throw new NotFoundException('Business not found');
    return {
      general: {
        name: b.name,
        startDate: b.start_date ? b.start_date.toISOString().slice(0, 10) : null,
        currencyId: b.currency_id,
        timeZone: b.time_zone,
        fyStartMonth: b.fy_start_month,
        accountingMethod: b.accounting_method,
        dateFormat: b.date_format,
        timeFormat: b.time_format,
        currencyPrecision: b.currency_precision,
        quantityPrecision: b.quantity_precision,
        transactionEditDays: b.transaction_edit_days,
        logo: b.logo,
      },
      tax: {
        taxLabel1: b.tax_label_1,
        taxNumber1: b.tax_number_1,
        taxLabel2: b.tax_label_2,
        taxNumber2: b.tax_number_2,
        defaultSalesTax: b.default_sales_tax,
        defaultSalesDiscount: b.default_sales_discount?.toString() ?? '0',
        sellPriceTax: b.sell_price_tax,
        enablePriceTax: b.enable_price_tax,
        enableInlineTax: b.enable_inline_tax,
      },
      product: {
        skuPrefix: b.sku_prefix,
        defaultProfitPercent: b.default_profit_percent,
        defaultUnit: b.default_unit,
        enableBrand: b.enable_brand,
        enableCategory: b.enable_category,
        enableSubCategory: b.enable_sub_category,
        enableSubUnits: b.enable_sub_units,
        enableRacks: b.enable_racks,
        enableRow: b.enable_row,
        enablePosition: b.enable_position,
        enableLotNumber: b.enable_lot_number,
        enableProductExpiry: b.enable_product_expiry,
        expiryType: b.expiry_type,
        onProductExpiry: b.on_product_expiry,
        stopSellingBefore: b.stop_selling_before,
        stockExpiryAlertDays: b.stock_expiry_alert_days,
        enableEditingProductFromPurchase: b.enable_editing_product_from_purchase,
        enablePurchaseStatus: b.enable_purchase_status ?? true,
      },
      refNoPrefixes: parseObject(b.ref_no_prefixes),
      enabledModules: parseArray(b.enabled_modules),
    };
  }

  async update(user: AuthUser, dto: BusinessSettingsDto) {
    const data: Prisma.businessUncheckedUpdateInput = { updated_at: new Date() };
    const set = <K extends keyof Prisma.businessUncheckedUpdateInput>(key: K, value: Prisma.businessUncheckedUpdateInput[K] | undefined) => {
      if (value !== undefined) data[key] = value;
    };

    // general
    set('name', dto.name);
    if (dto.startDate !== undefined) set('start_date', dto.startDate ? new Date(dto.startDate) : null);
    if (dto.currencyId !== undefined) {
      if (!(await this.prisma.currencies.findUnique({ where: { id: dto.currencyId } }))) throw new BadRequestException('Currency not found');
      set('currency_id', dto.currencyId);
    }
    if (dto.timeZone !== undefined) {
      if (!isValidTimeZone(dto.timeZone)) throw new BadRequestException('Unknown time zone');
      set('time_zone', dto.timeZone);
      this.prisma.setBusinessTimeZone(user.businessId, dto.timeZone);
    }
    set('fy_start_month', dto.fyStartMonth);
    set('accounting_method', dto.accountingMethod);
    set('date_format', dto.dateFormat);
    set('time_format', dto.timeFormat);
    set('currency_precision', dto.currencyPrecision);
    set('quantity_precision', dto.quantityPrecision);
    set('transaction_edit_days', dto.transactionEditDays);

    // tax
    set('tax_label_1', dto.taxLabel1);
    set('tax_number_1', dto.taxNumber1);
    set('tax_label_2', dto.taxLabel2);
    set('tax_number_2', dto.taxNumber2);
    if (dto.defaultSalesTax !== undefined && dto.defaultSalesTax !== null) {
      const tax = await this.prisma.forTenant(user.businessId).tax_rates.findFirst({ where: { id: dto.defaultSalesTax, deleted_at: null } });
      if (!tax) throw new BadRequestException('Default sales tax not found');
    }
    set('default_sales_tax', dto.defaultSalesTax);
    set('default_sales_discount', dto.defaultSalesDiscount);
    set('sell_price_tax', dto.sellPriceTax);
    set('enable_price_tax', dto.enablePriceTax);
    set('enable_inline_tax', dto.enableInlineTax);

    // product
    set('sku_prefix', dto.skuPrefix);
    set('default_profit_percent', dto.defaultProfitPercent);
    set('default_unit', dto.defaultUnit);
    set('enable_brand', dto.enableBrand);
    set('enable_category', dto.enableCategory);
    set('enable_sub_category', dto.enableSubCategory);
    set('enable_sub_units', dto.enableSubUnits);
    set('enable_racks', dto.enableRacks);
    set('enable_row', dto.enableRow);
    set('enable_position', dto.enablePosition);
    set('enable_lot_number', dto.enableLotNumber);
    set('enable_product_expiry', dto.enableProductExpiry);
    set('expiry_type', dto.expiryType);
    set('on_product_expiry', dto.onProductExpiry);
    set('stop_selling_before', stopSellingBeforeFor(dto.onProductExpiry, dto.stopSellingBefore));
    set('stock_expiry_alert_days', dto.stockExpiryAlertDays);
    set('enable_editing_product_from_purchase', dto.enableEditingProductFromPurchase);
    set('enable_purchase_status', dto.enablePurchaseStatus);

    // prefixes and enabled features
    if (dto.refNoPrefixes !== undefined) set('ref_no_prefixes', validateRefPrefixes(dto.refNoPrefixes));
    if (dto.enabledModules !== undefined) set('enabled_modules', JSON.stringify(validateEnabledModules(dto.enabledModules)));

    await this.prisma.business.update({ where: { id: user.businessId }, data });
    return this.get(user);
  }
}

function parseObject(raw: string | null): Record<string, string | null> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

function parseArray(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
