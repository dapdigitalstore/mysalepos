import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { PAYMENT_METHOD_PATTERN } from './sell-return.rules';

/** Empty strings from forms mean "not given". */
const emptyToUndefined = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value));

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ReturnLineDto {
  @Type(() => Number) @IsInt() @Min(1) sellLineId: number;

  /** Quantity returned, in the unit shown on the sale line (sub unit aware). 0 = nothing returned for this line. */
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(999999999999) quantity: number;
}

/**
 * Body of POST /sell-returns and PUT /sell-returns/:id (the Laravel "sell return" form).
 * The lines describe the WHOLE return: a sale line that is not listed counts as 0 returned.
 */
export class SaveSellReturnDto {
  /** The sale being returned. Required when creating; ignored on PUT (the return already knows its sale). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleId?: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) products: ReturnLineDto[];

  /** '' = no discount. Missing = fixed (Laravel default). */
  @IsOptional() @IsIn(['', 'fixed', 'percentage']) discountType?: '' | 'fixed' | 'percentage';
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) discountAmount?: number;

  /** Leave empty to number it automatically (the `sell_return` prefix, e.g. CN2026/0001). */
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) invoiceNo?: string;

  /** ISO date-time of the return. Defaults to now when creating, unchanged when editing. */
  @IsOptional() @emptyToUndefined() @IsDateString() transactionDate?: string;
}

export class SellReturnListQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) createdBy?: number;
  /** Only the return of this sale. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleId?: number;
  @IsOptional() @emptyToUndefined() @IsIn(['paid', 'due', 'partial']) paymentStatus?: 'paid' | 'due' | 'partial';
  /** YYYY-MM-DD in the business time zone. */
  @IsOptional() @emptyToUndefined() @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string;
  @IsOptional() @emptyToUndefined() @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string;
}

/** Final sales the user can start a return from. */
export class ReturnableSalesQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @IsOptional() @emptyToUndefined() @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string;
  @IsOptional() @emptyToUndefined() @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string;
}

/** Exactly one of the two. */
export class LookupQueryDto {
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) invoiceNo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleId?: number;
}

/** A refund paid to the customer for a return (Laravel: "Add payment" on the sell return row). */
export class ReturnPaymentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) amount: number;
  @IsString() @Matches(PAYMENT_METHOD_PATTERN, { message: 'method is not valid' }) method: string;
  /** ISO date-time. Defaults to now. */
  @IsOptional() @emptyToUndefined() @IsDateString() paidOn?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) cardNumber?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) cardHolderName?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) cardTransactionNumber?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) cardType?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(20) cardMonth?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(20) cardYear?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(5) cardSecurity?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) chequeNumber?: string;
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) bankAccountNumber?: string;
  /** Reference of a custom payment method (custom_pay_1..7). */
  @IsOptional() @emptyToUndefined() @IsString() @MaxLength(191) transactionNo?: string;
}
