import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BrandDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsBoolean() useForRepair?: boolean;
}
