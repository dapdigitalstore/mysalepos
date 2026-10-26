import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SellingPriceGroupDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
}
