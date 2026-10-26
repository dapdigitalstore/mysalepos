import { Type } from 'class-transformer';
import { IsEmail, IsNumber, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CommissionAgentDto {
  @IsOptional() @IsString() @MaxLength(10) surname?: string;
  @IsString() @MinLength(1) @MaxLength(191) firstName: string;
  @IsOptional() @IsString() @MaxLength(191) lastName?: string;
  /** Optional; an empty string is allowed and stored as NULL. */
  @ValidateIf((o: CommissionAgentDto) => o.email !== undefined && o.email !== '') @IsEmail() @MaxLength(191) email?: string;
  @IsOptional() @IsString() @MaxLength(15) contactNo?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @Type(() => Number) @IsNumber() cmmsnPercent: number;
}
