import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const ACCOUNTING_METHODS = ['fifo', 'lifo', 'avco'] as const;
export const EXPIRY_TYPES = ['add_expiry', 'add_manufacturing'] as const;
export const ON_EXPIRY = ['keep_selling', 'stop_selling', 'auto_delete'] as const;
export const SELL_PRICE_TAX = ['includes', 'excludes'] as const;

/** Features a business can switch on or off (stored in business.enabled_modules). */
export const FEATURE_KEYS = [
  'purchases', 'add_sale', 'pos_sale', 'stock_transfers', 'stock_adjustment', 'expenses', 'account',
  'tables', 'modifiers', 'service_staff', 'booking', 'kitchen', 'subscription', 'types_of_service',
] as const;

/** Document types that can have a prefix (business.ref_no_prefixes). */
export const REFERENCE_TYPES = [
  'purchase', 'purchase_return', 'purchase_requisition', 'purchase_order', 'stock_transfer', 'stock_adjustment',
  'sell_return', 'expense', 'contacts', 'purchase_payment', 'sell_payment', 'expense_payment', 'business_location',
  'username', 'subscription', 'draft', 'sales_order',
] as const;

/** Every field is optional so each settings tab can save just its own part. */
export class BusinessSettingsDto {
  // ---- general
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) name?: string;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) currencyId?: number;
  @IsOptional() @IsString() @MaxLength(60) timeZone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) fyStartMonth?: number;
  @IsOptional() @IsIn(ACCOUNTING_METHODS) accountingMethod?: (typeof ACCOUNTING_METHODS)[number];
  @IsOptional() @IsString() @MaxLength(20) dateFormat?: string;
  @IsOptional() @IsIn(['12', '24']) timeFormat?: '12' | '24';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) currencyPrecision?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) quantityPrecision?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) transactionEditDays?: number;

  // ---- tax
  @IsOptional() @IsString() @MaxLength(10) taxLabel1?: string | null;
  @IsOptional() @IsString() @MaxLength(100) taxNumber1?: string | null;
  @IsOptional() @IsString() @MaxLength(10) taxLabel2?: string | null;
  @IsOptional() @IsString() @MaxLength(100) taxNumber2?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) defaultSalesTax?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) defaultSalesDiscount?: number;
  @IsOptional() @IsIn(SELL_PRICE_TAX) sellPriceTax?: (typeof SELL_PRICE_TAX)[number];
  @IsOptional() @IsBoolean() enablePriceTax?: boolean;
  @IsOptional() @IsBoolean() enableInlineTax?: boolean;

  // ---- product
  @IsOptional() @IsString() @MaxLength(191) skuPrefix?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000) defaultProfitPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) defaultUnit?: number | null;
  @IsOptional() @IsBoolean() enableBrand?: boolean;
  @IsOptional() @IsBoolean() enableCategory?: boolean;
  @IsOptional() @IsBoolean() enableSubCategory?: boolean;
  @IsOptional() @IsBoolean() enableSubUnits?: boolean;
  @IsOptional() @IsBoolean() enableRacks?: boolean;
  @IsOptional() @IsBoolean() enableRow?: boolean;
  @IsOptional() @IsBoolean() enablePosition?: boolean;
  @IsOptional() @IsBoolean() enableLotNumber?: boolean;
  @IsOptional() @IsBoolean() enableProductExpiry?: boolean;
  @IsOptional() @IsIn(EXPIRY_TYPES) expiryType?: (typeof EXPIRY_TYPES)[number];
  @IsOptional() @IsIn(ON_EXPIRY) onProductExpiry?: (typeof ON_EXPIRY)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) stopSellingBefore?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) stockExpiryAlertDays?: number;
  @IsOptional() @IsBoolean() enableEditingProductFromPurchase?: boolean;
  @IsOptional() @IsBoolean() enablePurchaseStatus?: boolean;

  // ---- prefixes and modules
  @IsOptional() @IsObject() refNoPrefixes?: Record<string, string | null>;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) enabledModules?: string[];
}
