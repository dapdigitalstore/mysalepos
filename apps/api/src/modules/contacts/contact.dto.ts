import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { CONTACT_TYPES, type ContactKind, type ContactType, type PayTermType } from './contact.rules';

/** Empty strings from forms are stored as "not given". */
const emptyToNull = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value));

const str = (max = 191) => [IsOptional(), emptyToNull(), IsString(), MaxLength(max)];

function Opt(max = 191): PropertyDecorator {
  return (target, key) => {
    for (const d of str(max)) d(target, key);
  };
}

/** Body of POST /contacts and PUT /contacts/:id (same shape as the Laravel contact form). */
export class ContactDto {
  @IsIn(CONTACT_TYPES) type: ContactType;
  @IsOptional() @IsIn(['individual', 'business']) contactType?: ContactKind;

  /** Leave empty to auto-generate (CO0001...). Must be unique per business. */
  @Opt(191) contactId?: string | null;

  @Opt() supplierBusinessName?: string | null;
  @Opt(20) prefix?: string | null;
  @Opt() firstName?: string | null;
  @Opt() middleName?: string | null;
  @Opt() lastName?: string | null;

  @IsString() @MaxLength(50) mobile: string;
  @Opt(50) alternateNumber?: string | null;
  @Opt(50) landline?: string | null;
  @IsOptional() @emptyToNull() @IsEmail() @MaxLength(191) email?: string | null;

  /** YYYY-MM-DD. */
  @IsOptional() @emptyToNull() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob must be a date in YYYY-MM-DD format' }) dob?: string | null;

  @Opt(191) taxNumber?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) payTermNumber?: number | null;
  @IsOptional() @emptyToNull() @IsIn(['days', 'months']) payTermType?: PayTermType | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) creditLimit?: number | null;
  /** Opening balance still owed (customer owes us / we owe supplier). */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) openingBalance?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerGroupId?: number | null;

  @Opt() addressLine1?: string | null;
  @Opt() addressLine2?: string | null;
  @Opt() city?: string | null;
  @Opt() state?: string | null;
  @Opt() country?: string | null;
  @Opt(20) zipCode?: string | null;
  @Opt() landMark?: string | null;
  @Opt() streetName?: string | null;
  @Opt() buildingNumber?: string | null;
  @Opt() additionalNumber?: string | null;
  @Opt(1000) shippingAddress?: string | null;
  @Opt() position?: string | null;

  /** Users who may see this contact when they only hold the "view own" permission. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @Type(() => Number) @IsInt({ each: true }) assignedToUsers?: number[];
}

/** GET /contacts */
export class ContactListQueryDto extends PageQueryDto {
  @IsIn(['supplier', 'customer']) type: 'supplier' | 'customer';
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerGroupId?: number;
  /** due = owes / is owed money, advance = holds an advance balance, opening = has an opening balance. */
  @IsOptional() @IsIn(['due', 'advance', 'opening']) balance?: 'due' | 'advance' | 'opening';
}

/** GET /contacts/options */
export class ContactOptionsQueryDto {
  @IsIn(['supplier', 'customer']) type: 'supplier' | 'customer';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  /** Set to true to include the default walk-in customer (default for customers, never for suppliers). */
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true)) @IsBoolean() includeDefault?: boolean;
}

export class CheckMobileQueryDto {
  @IsString() @MaxLength(50) mobile: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) excludeId?: number;
}

export class CheckContactIdQueryDto {
  @IsString() @MaxLength(191) contactId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) excludeId?: number;
}
