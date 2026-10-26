import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UnitDto {
  @IsString() @MinLength(1) @MaxLength(191) actualName: string;
  @IsString() @MinLength(1) @MaxLength(191) shortName: string;
  @IsBoolean() allowDecimal: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) baseUnitId?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) baseUnitMultiplier?: number | null;
}
