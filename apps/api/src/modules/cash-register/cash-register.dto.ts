import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

/** Money arrives as a string from forms; plain JSON numbers are accepted too. The rules parse it as a Decimal. */
const amountString = () => Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value));

/** Body of POST /cash-registers (Laravel: CashRegisterController@store). */
export class OpenRegisterDto {
  /** Cash in hand (opening cash). */
  @amountString() @IsString() @MaxLength(30) amount: string;

  /** Business location. Optional when the user may use exactly one location. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
}

/** Body of POST /cash-registers/current/close and /cash-registers/:id/close (Laravel: postCloseRegister). */
export class CloseRegisterDto {
  @amountString() @IsString() @MaxLength(30) closingAmount: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) totalCardSlips: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) totalCheques: number;
  @IsOptional() @IsString() @MaxLength(5000) closingNote?: string | null;

  /** `{ "<note value>": <count> }`, only meaningful when the business uses cash denominations. */
  @IsOptional() @IsObject() denominations?: Record<string, number | string | null> | null;
}

/** Query of GET /cash-registers (the register report). */
export class RegisterListQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) locationId?: number;
  @IsOptional() @IsIn(['open', 'close']) status?: 'open' | 'close';
  /** YYYY-MM-DD, whole days in the business time zone. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' }) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string;
}
