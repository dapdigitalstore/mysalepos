import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Query string shared by every list endpoint: pagination, search and sorting. */
export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage: number = 25;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(50) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir: 'asc' | 'desc' = 'asc';
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function paginated<T>(data: T[], total: number, q: Pick<PageQueryDto, 'page' | 'perPage'>): Paginated<T> {
  return { data, meta: { page: q.page, perPage: q.perPage, total, totalPages: Math.max(1, Math.ceil(total / q.perPage)) } };
}

export function skipTake(q: Pick<PageQueryDto, 'page' | 'perPage'>) {
  return { skip: (q.page - 1) * q.perPage, take: q.perPage };
}

/** Safe ORDER BY: only whitelisted columns can be sorted on, anything else falls back to `fallback`. */
export function orderBy(q: Pick<PageQueryDto, 'sortBy' | 'sortDir'>, allowed: readonly string[], fallback: string) {
  const key = q.sortBy && allowed.includes(q.sortBy) ? q.sortBy : fallback;
  return { [key]: q.sortDir } as Record<string, 'asc' | 'desc'>;
}
