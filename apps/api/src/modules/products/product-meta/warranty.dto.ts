import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DURATION_TYPES } from './warranty.rules';

export class WarrantyDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) duration: number;
  @IsIn(DURATION_TYPES as unknown as string[]) durationType: string;
}
