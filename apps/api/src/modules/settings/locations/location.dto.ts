import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class LocationDto {
  @IsString() @MinLength(1) @MaxLength(256) name: string;
  /** Custom location code; generated (BL0001...) when empty. Must be unique within the business. */
  @IsOptional() @IsString() @MaxLength(191) locationId?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) landmark?: string | null;
  @IsString() @MinLength(1) @MaxLength(100) country: string;
  @IsString() @MinLength(1) @MaxLength(100) state: string;
  @IsString() @MinLength(1) @MaxLength(100) city: string;
  @IsString() @MinLength(1) @MaxLength(7) zipCode: string;
  @Type(() => Number) @IsInt() @Min(1) invoiceSchemeId: number;
  @Type(() => Number) @IsInt() @Min(1) invoiceLayoutId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleInvoiceSchemeId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleInvoiceLayoutId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sellingPriceGroupId?: number | null;
  @IsOptional() @IsString() @MaxLength(191) mobile?: string | null;
  @IsOptional() @IsString() @MaxLength(191) alternateNumber?: string | null;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsString() @MaxLength(191) website?: string | null;
  @IsOptional() @IsString() @MaxLength(191) customField1?: string | null;
  @IsOptional() @IsString() @MaxLength(191) customField2?: string | null;
  @IsOptional() @IsString() @MaxLength(191) customField3?: string | null;
  @IsOptional() @IsString() @MaxLength(191) customField4?: string | null;
}
