import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CategoryDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsOptional() @IsString() @MaxLength(191) shortCode?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  /** 0 or omitted = main category; otherwise the id of the parent (main) category. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) parentId?: number;
}
