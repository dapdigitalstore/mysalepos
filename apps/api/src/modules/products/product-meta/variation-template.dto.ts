import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class VariationValueDto {
  /** Present for values that already exist (keeps their id on edit); omitted for new rows. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number | null;
  @IsString() @MaxLength(191) name: string;
}

export class VariationTemplateDto {
  @IsString() @MinLength(1) @MaxLength(191) name: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VariationValueDto) values: VariationValueDto[];
}
