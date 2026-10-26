import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CustomerGroupDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsIn(['percentage', 'selling_price_group']) priceCalculationType: 'percentage' | 'selling_price_group';
  /** Percentage added (positive) or discounted (negative) from the selling price. Used when type is percentage. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) amount?: number | null;
  /** Used when type is selling_price_group. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sellingPriceGroupId?: number | null;
}
