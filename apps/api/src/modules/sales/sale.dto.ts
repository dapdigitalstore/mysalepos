import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

/** A money / quantity / percent sent as a JSON number or a numeric string. Parsed to Decimal in the rules. */
export function IsAmount(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAmount',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} must be a number`, ...options },
      validator: {
        validate: (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))),
      },
    });
}

export const SALE_STATUSES = ['final', 'draft', 'quotation', 'proforma'] as const;
export const DISCOUNT_TYPES = ['fixed', 'percentage'] as const;
export const SHIPPING_STATUSES = ['ordered', 'packed', 'shipped', 'delivered', 'cancelled'] as const;

/** One payment line of a sale. */
export class SalePaymentDto {
  /** Existing payment (transaction_payments.id) when editing a sale; omit for a new payment. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  /** cash, card, cheque, bank_transfer, other, custom_pay_1..7, advance */
  @IsString() @MaxLength(50) method: string;
  @IsAmount() amount: number | string;
  /** When the money was received (ISO date-time). Defaults to now. */
  @IsOptional() @IsDateString() paidOn?: string;
  @IsOptional() @IsString() @MaxLength(5000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardTransactionNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardType?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardHolderName?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardMonth?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardYear?: string | null;
  @IsOptional() @IsString() @MaxLength(5) cardSecurity?: string | null;
  @IsOptional() @IsString() @MaxLength(191) chequeNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) bankAccountNumber?: string | null;
  /** Reference number of a custom_pay_N payment (Laravel `transaction_no_N`). */
  @IsOptional() @IsString() @MaxLength(191) transactionNo?: string | null;
  /** accounts.id the money goes to (only used when the account module is enabled). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) accountId?: number | null;
}

export class SaleLineDto {
  /** Existing sell line (transaction_sell_lines.id) when editing; omit for a new line. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @Type(() => Number) @IsInt() @Min(1) productId: number;
  @Type(() => Number) @IsInt() @Min(1) variationId: number;
  /** Quantity in the unit chosen by `subUnitId` (the product's own unit when omitted). Must be greater than 0. */
  @IsAmount() quantity: number | string;
  /** Selling price per unit EXCLUDING tax and BEFORE the line discount, in the chosen unit. */
  @IsAmount() unitPrice: number | string;
  @IsOptional() @IsIn(DISCOUNT_TYPES) lineDiscountType?: (typeof DISCOUNT_TYPES)[number] | null;
  @IsOptional() @IsAmount() lineDiscountAmount?: number | string | null;
  /** Tax rate of the line (tax_rates.id). Ignored when the business has inline tax disabled. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) taxId?: number | null;
  /** units.id of a sub-unit of the product's unit; omit for the product's own unit. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) subUnitId?: number | null;
  @IsOptional() @IsString() @MaxLength(5000) sellLineNote?: string | null;
  /** purchase_lines.id to take the stock from (lot / expiry businesses). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lotNoLineId?: number | null;
  @IsOptional() @IsAmount() secondaryUnitQuantity?: number | string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resServiceStaffId?: number | null;
}

export class AdditionalExpenseDto {
  @IsString() @MaxLength(191) key: string;
  @IsAmount() value: number | string;
}

export class SaleDto {
  /** `final` = invoice, `draft`, `quotation` (draft + quotation), `proforma` (draft + proforma). */
  @IsIn(SALE_STATUSES) status: (typeof SALE_STATUSES)[number];
  /** true for the "Add sale" screen (no cash register needed, no register rows), false/omitted for the POS screen. */
  @IsOptional() @IsBoolean() isDirectSale?: boolean;
  /** Suspend the sale: stored as a final sale without payments. */
  @IsOptional() @IsBoolean() isSuspend?: boolean;
  /** Sale on credit: the payments sent are ignored. */
  @IsOptional() @IsBoolean() isCreditSale?: boolean;
  @Type(() => Number) @IsInt() @Min(1) locationId: number;
  @Type(() => Number) @IsInt() @Min(1) contactId: number;
  /** ISO date-time. Defaults to now on create, unchanged on update. */
  @IsOptional() @IsDateString() transactionDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) invoiceSchemeId?: number | null;
  /** A custom invoice number; must be unique. Normally omitted: the number comes from the invoice scheme. */
  @IsOptional() @IsString() @MaxLength(191) invoiceNo?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sellingPriceGroupId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) commissionAgentId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) payTermNumber?: number | null;
  @IsOptional() @IsIn(['days', 'months']) payTermType?: 'days' | 'months' | null;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines: SaleLineDto[];

  @IsOptional() @IsIn(DISCOUNT_TYPES) discountType?: (typeof DISCOUNT_TYPES)[number] | null;
  @IsOptional() @IsAmount() discountAmount?: number | string | null;
  /** Order tax (tax_rates.id), applied to the total after discount. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) taxRateId?: number | null;

  @IsOptional() @IsAmount() shippingCharges?: number | string | null;
  @IsOptional() @IsString() @MaxLength(5000) shippingDetails?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) shippingAddress?: string | null;
  @IsOptional() @IsIn(SHIPPING_STATUSES) shippingStatus?: (typeof SHIPPING_STATUSES)[number] | null;
  @IsOptional() @IsString() @MaxLength(191) deliveredTo?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) deliveryPerson?: number | null;
  /** shipping_custom_field_1..5 */
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) shippingCustomFields?: string[];
  /** custom_field_1..4 */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) customFields?: string[];
  /** Up to 4 named extra charges (additional_expense_key_N / value_N). */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => AdditionalExpenseDto) additionalExpenses?: AdditionalExpenseDto[];

  /** Types of service (only when the module is enabled). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) typesOfServiceId?: number | null;
  @IsOptional() @IsAmount() packingCharge?: number | string | null;
  @IsOptional() @IsIn(['fixed', 'percent']) packingChargeType?: 'fixed' | 'percent' | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resTableId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resWaiterId?: number | null;
  @IsOptional() @IsBoolean() isKitchenOrder?: boolean;

  /** Printed on the invoice (additional_notes). */
  @IsOptional() @IsString() @MaxLength(5000) saleNote?: string | null;
  /** Internal note (staff_note). */
  @IsOptional() @IsString() @MaxLength(5000) staffNote?: string | null;
  @IsOptional() @IsAmount() exchangeRate?: number | string | null;

  /** Reward points the customer redeems on this sale, and their money value. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) rpRedeemed?: number;
  @IsOptional() @IsAmount() rpRedeemedAmount?: number | string | null;

  /**
   * Payments. On create: new payments. On update: when present it REPLACES the payment list (rows with `id` are edited,
   * rows without are added, existing payments not listed are deleted); when omitted the payments are left untouched.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SalePaymentDto) payments?: SalePaymentDto[];
  /** Change given back to the customer (stored as a payment with is_return = 1). */
  @IsOptional() @IsAmount() changeReturn?: number | string | null;
  /** On update: the existing change-return payment to edit (transaction_payments.id with is_return = 1). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) changeReturnPaymentId?: number | null;
  @IsOptional() @IsString() @MaxLength(50) changeReturnMethod?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) changeReturnAccountId?: number | null;
}

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true || value === '1' ? true : value === 'false' || value === false || value === '0' ? false : undefined);

export class SaleListQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) contactId?: number;
  @IsOptional() @IsIn(['paid', 'due', 'partial', 'overdue']) paymentStatus?: 'paid' | 'due' | 'partial' | 'overdue';
  /** Default `final`. `draft` is served by GET /sales/drafts. */
  @IsOptional() @IsIn(['final']) status?: 'final';
  @IsOptional() @IsIn(SHIPPING_STATUSES) shippingStatus?: (typeof SHIPPING_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) createdBy?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) commissionAgentId?: number;
  /** Local calendar days (YYYY-MM-DD) in the business time zone, both ends inclusive. */
  @IsOptional() @IsDateString({ strict: false }) startDate?: string;
  @IsOptional() @IsDateString({ strict: false }) endDate?: string;
  @IsOptional() @IsString() @MaxLength(50) paymentMethod?: string;
  /** true = only "Add sale" sales, false = only POS sales. */
  @IsOptional() @Transform(toBool) @IsBoolean() isDirectSale?: boolean;
  /** true = only suspended sales. */
  @IsOptional() @Transform(toBool) @IsBoolean() isSuspend?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) typesOfServiceId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) resWaiterId?: number;
  /** true = only sales that have a shipping status. */
  @IsOptional() @Transform(toBool) @IsBoolean() onlyShipments?: boolean;
}

export class DraftListQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) contactId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) createdBy?: number;
  @IsOptional() @IsDateString({ strict: false }) startDate?: string;
  @IsOptional() @IsDateString({ strict: false }) endDate?: string;
}

export class RecentQueryDto {
  @IsOptional() @IsIn(['final', 'draft', 'quotation']) status?: 'final' | 'draft' | 'quotation';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class PosSettingsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
}

export class ProductRowQueryDto {
  @Type(() => Number) @IsInt() @Min(1) variationId: number;
  @Type(() => Number) @IsInt() @Min(1) locationId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) contactId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) priceGroupId?: number;
  /** Quantity to pre-fill; default 1. */
  @IsOptional() @IsAmount() quantity?: number | string;
  /** Drafts and quotations may contain products that are out of stock. */
  @IsOptional() @Transform(toBool) @IsBoolean() isDraft?: boolean;
  /** true on the "Add sale" screen (decides which price / discount permission applies). */
  @IsOptional() @Transform(toBool) @IsBoolean() isDirectSale?: boolean;
}

export class InvoiceNoQueryDto {
  @IsString() @MaxLength(191) invoiceNo: string;
  /** The sale being edited (its own number is not a duplicate). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) excludeId?: number;
}

/** Payment sent to POST /sales/:id/payments and PUT /sale-payments/:id. */
export class PaymentDto {
  @IsString() @MaxLength(50) method: string;
  @IsAmount() amount: number | string;
  @IsOptional() @IsDateString() paidOn?: string;
  @IsOptional() @IsString() @MaxLength(5000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardTransactionNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardType?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardHolderName?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardMonth?: string | null;
  @IsOptional() @IsString() @MaxLength(191) cardYear?: string | null;
  @IsOptional() @IsString() @MaxLength(5) cardSecurity?: string | null;
  @IsOptional() @IsString() @MaxLength(191) chequeNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) bankAccountNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(191) transactionNo?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) accountId?: number | null;
}
