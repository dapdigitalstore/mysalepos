import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { USER_STATUSES, type UserStatus } from './user.rules';

export class BankDetailsDto {
  @IsOptional() @IsString() @MaxLength(191) accountHolderName?: string;
  @IsOptional() @IsString() @MaxLength(191) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(191) bankName?: string;
  @IsOptional() @IsString() @MaxLength(191) bankCode?: string;
  @IsOptional() @IsString() @MaxLength(191) branch?: string;
  @IsOptional() @IsString() @MaxLength(191) taxPayerId?: string;
}

/** The "more info" block shared by the user form and the profile page. A field left out is left unchanged; '' clears it. */
export class PersonalInfoDto {
  @IsOptional() @IsString() @MaxLength(10) surname?: string;
  @IsString() @MinLength(1) @MaxLength(191) firstName: string;
  @IsOptional() @IsString() @MaxLength(191) lastName?: string;
  @IsOptional() @IsString() @MaxLength(7) language?: string;
  /** YYYY-MM-DD */
  @IsOptional() @IsString() @MaxLength(10) dob?: string;
  @IsOptional() @IsIn(['male', 'female', 'others', '']) gender?: string;
  @IsOptional() @IsIn(['married', 'unmarried', 'divorced', '']) maritalStatus?: string;
  @IsOptional() @IsString() @MaxLength(10) bloodGroup?: string;
  @IsOptional() @IsString() @MaxLength(20) contactNumber?: string;
  @IsOptional() @IsString() @MaxLength(191) altNumber?: string;
  @IsOptional() @IsString() @MaxLength(191) familyNumber?: string;
  @IsOptional() @IsString() @MaxLength(191) fbLink?: string;
  @IsOptional() @IsString() @MaxLength(191) twitterLink?: string;
  @IsOptional() @IsString() @MaxLength(191) socialMedia1?: string;
  @IsOptional() @IsString() @MaxLength(191) socialMedia2?: string;
  @IsOptional() @IsString() @MaxLength(191) customField1?: string;
  @IsOptional() @IsString() @MaxLength(191) customField2?: string;
  @IsOptional() @IsString() @MaxLength(191) customField3?: string;
  @IsOptional() @IsString() @MaxLength(191) customField4?: string;
  @IsOptional() @IsString() @MaxLength(191) guardianName?: string;
  @IsOptional() @IsString() @MaxLength(191) idProofName?: string;
  @IsOptional() @IsString() @MaxLength(191) idProofNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) permanentAddress?: string;
  @IsOptional() @IsString() @MaxLength(2000) currentAddress?: string;
  @IsOptional() @ValidateNested() @Type(() => BankDetailsDto) bankDetails?: BankDetailsDto;
}

/** Add / edit a user (PUT replaces the form; the password may be left out on edit). */
export class UserDto extends PersonalInfoDto {
  @IsEmail() @MaxLength(191) email: string;
  @IsOptional() @IsIn(USER_STATUSES) status?: UserStatus;
  @Type(() => Number) @IsInt() @Min(1) roleId: number;

  @IsBoolean() allowLogin: boolean;
  /** Typed without the business suffix; the API adds it. Left empty a username is generated. */
  @IsOptional() @IsString() @MaxLength(191) username?: string;
  @IsOptional() @IsString() @MaxLength(100) password?: string;

  @IsOptional() @Type(() => Number) @IsNumber() cmmsnPercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxSalesDiscountPercent?: number | null;

  @IsOptional() @IsBoolean() isEnableServiceStaffPin?: boolean;
  @IsOptional() @IsString() @MaxLength(20) serviceStaffPin?: string;

  @IsBoolean() accessAllLocations: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsInt({ each: true }) locationIds?: number[];

  @IsOptional() @IsBoolean() selectedContacts?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsInt({ each: true }) selectedContactIds?: number[];
}

/** Own profile: names, email, language and the personal block. Username, role and permissions are not editable here. */
export class ProfileDto extends PersonalInfoDto {
  @IsEmail() @MaxLength(191) email: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(100) currentPassword: string;
  @IsString() @MinLength(1) @MaxLength(100) newPassword: string;
}
