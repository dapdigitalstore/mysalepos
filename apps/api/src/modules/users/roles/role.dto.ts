import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RoleDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsBoolean() isServiceStaff?: boolean;
  /** Every ticked permission name (radio choices included). Validated against the catalog in the service. */
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(100, { each: true }) permissions: string[];
}
