import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class TaxRateDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) amount: number;
  /** A tax that is only meant to be part of a tax group (hidden from product/sale dropdowns). */
  @IsOptional() @IsBoolean() forTaxGroup?: boolean;
}

export class TaxGroupDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsArray() @ArrayMinSize(1) @Type(() => Number) @IsInt({ each: true }) taxIds: number[];
}
