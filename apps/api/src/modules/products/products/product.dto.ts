import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  MinLength,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination';

/** A money / quantity / percent sent as a JSON number or a numeric string. Kept as sent; Decimal parsing happens in the rules. */
export function IsAmount(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAmount',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} must be a number`, ...options },
      validator: {
        validate: (v: unknown) =>
          (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))),
      },
    });
}

export const PRODUCT_TYPES = ['single', 'variable', 'combo'] as const;
export const BARCODE_TYPES = ['C128', 'C39', 'EAN13', 'EAN8', 'UPCA', 'UPCE'] as const;

/** The five stored prices of a variation. See calculateVariationPrices for which one wins. */
export class PriceInputDto {
  @IsOptional() @IsAmount() purchasePriceExcTax?: number | string;
  @IsOptional() @IsAmount() purchasePriceIncTax?: number | string;
  @IsOptional() @IsAmount() profitPercent?: number | string;
  @IsOptional() @IsAmount() sellingPriceExcTax?: number | string;
  @IsOptional() @IsAmount() sellingPriceIncTax?: number | string;
}

export class ComboItemDto {
  @Type(() => Number) @IsInt() @Min(1) variationId: number;
  @IsAmount() quantity: number | string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) unitId?: number;
}

export class VariationValueDto {
  /** Existing variation id when editing; omit for a new value. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(191) subSku?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) variationValueId?: number;
  @IsOptional() @IsAmount() purchasePriceExcTax?: number | string;
  @IsOptional() @IsAmount() purchasePriceIncTax?: number | string;
  @IsOptional() @IsAmount() profitPercent?: number | string;
  @IsOptional() @IsAmount() sellingPriceExcTax?: number | string;
  @IsOptional() @IsAmount() sellingPriceIncTax?: number | string;
}

export class VariationGroupDto {
  /** Existing product_variations id when editing; omit for a new group. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) variationTemplateId?: number;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VariationValueDto) variations: VariationValueDto[];
}

export class ProductDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsIn(PRODUCT_TYPES) type: (typeof PRODUCT_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(191) sku?: string;
  @IsOptional() @IsIn(BARCODE_TYPES) barcodeType?: (typeof BARCODE_TYPES)[number];
  @Type(() => Number) @IsInt() @Min(1) unitId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) secondaryUnitId?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @Type(() => Number) @IsInt({ each: true }) subUnitIds?: number[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) brandId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) subCategoryId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) taxId?: number | null;
  @IsOptional() @IsIn(['inclusive', 'exclusive']) taxType?: 'inclusive' | 'exclusive';
  @IsOptional() @IsBoolean() enableStock?: boolean;
  @IsOptional() @IsAmount() alertQuantity?: number | string | null;
  @IsOptional() @IsAmount() expiryPeriod?: number | string | null;
  @IsOptional() @IsIn(['days', 'months']) expiryPeriodType?: 'days' | 'months' | null;
  @IsOptional() @IsBoolean() enableSrNo?: boolean;
  @IsOptional() @IsString() @MaxLength(191) weight?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) description?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) warrantyId?: number | null;
  @IsOptional() @IsBoolean() notForSelling?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) preparationTimeInMinutes?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @Type(() => Number) @IsInt({ each: true }) locationIds?: number[];

  /** Prices of the single variation of a `single` or `combo` product. */
  @IsOptional() @ValidateNested() @Type(() => PriceInputDto) prices?: PriceInputDto;
  /** Components of a `combo` product. The purchase price is calculated from them. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ComboItemDto) comboItems?: ComboItemDto[];
  /** Variation groups of a `variable` product. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => VariationGroupDto) variationGroups?: VariationGroupDto[];
  @IsOptional() @IsIn(['with_variation', 'with_out_variation']) skuType?: 'with_variation' | 'with_out_variation';
}

const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined);

export class ProductListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(PRODUCT_TYPES) type?: (typeof PRODUCT_TYPES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) subCategoryId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) brandId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) unitId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) taxId?: number;
  /** A location id, or `none` for products that are not assigned to any location. */
  @IsOptional() @IsString() @MaxLength(10) locationId?: string;
  @IsOptional() @IsIn(['active', 'inactive']) activeState?: 'active' | 'inactive';
  @IsOptional() @IsIn(['not_tracked', 'out_of_stock', 'low_stock', 'in_stock']) stockStatus?: 'not_tracked' | 'out_of_stock' | 'low_stock' | 'in_stock';
  @IsOptional() @Transform(toBool) @IsBoolean() notForSelling?: boolean;
}

export class SearchQueryDto {
  @IsOptional() @IsString() @MaxLength(100) term?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() checkQty?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) priceGroupId?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() notForSelling?: boolean;
  /** Comma separated, e.g. `single,variable`. */
  @IsOptional() @IsString() @MaxLength(50) productTypes?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CheckSkuQueryDto {
  @IsString() @MaxLength(191) sku: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) variationId?: number;
}

export class BulkActionDto {
  @IsIn(['delete', 'deactivate', 'activate']) action: 'delete' | 'deactivate' | 'activate';
  @IsArray() @ArrayMaxSize(500) @Type(() => Number) @IsInt({ each: true }) ids: number[];
}

export class GroupPriceRowDto {
  @Type(() => Number) @IsInt() @Min(1) variationId: number;
  @Type(() => Number) @IsInt() @Min(1) priceGroupId: number;
  /** Empty/null removes the price of this group for the variation. */
  @IsOptional() @IsAmount() price?: number | string | null;
  @IsIn(['fixed', 'percentage']) priceType: 'fixed' | 'percentage';
}

export class GroupPricesDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => GroupPriceRowDto) prices: GroupPriceRowDto[];
}

export class OpeningStockRowDto {
  /** Existing purchase line when editing; omit for a new row. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) purchaseLineId?: number;
  @Type(() => Number) @IsInt() @Min(1) variationId: number;
  /** Quantity in stock (for an existing row: the quantity still remaining). */
  @IsAmount() quantity: number | string;
  /** Unit purchase price excluding tax. */
  @IsAmount() purchasePrice: number | string;
  @IsOptional() @IsDateString() transactionDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsDateString() expDate?: string | null;
  @IsOptional() @IsString() @MaxLength(191) lotNumber?: string | null;
}

export class OpeningStockLocationDto {
  @Type(() => Number) @IsInt() @Min(1) locationId: number;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => OpeningStockRowDto) rows: OpeningStockRowDto[];
}

export class OpeningStockDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OpeningStockLocationDto) stocks: OpeningStockLocationDto[];
}
