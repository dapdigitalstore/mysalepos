import { BadRequestException, ForbiddenException } from '@nestjs/common';

/** Spatie role names are stored per business as `<name>#<business_id>` (e.g. `Cashier#1`). */
const SEPARATOR = '#';
export const ROLE_NAME_MAX = 80;

export interface RoleLike {
  name: string;
  is_default: boolean;
}

/** Trims and validates the name a person typed. `#` is reserved for the business suffix. */
export function cleanRoleName(raw: string): string {
  const name = (raw ?? '').trim();
  if (name.length === 0) throw new BadRequestException('Role name is required');
  if (name.length > ROLE_NAME_MAX) throw new BadRequestException(`Role name must be at most ${ROLE_NAME_MAX} characters`);
  if (name.includes(SEPARATOR)) throw new BadRequestException('Role name cannot contain the # character');
  return name;
}

/** Name as stored in the `roles` table. */
export function storedRoleName(name: string, businessId: number): string {
  return `${cleanRoleName(name)}${SEPARATOR}${businessId}`;
}

/** Name shown to people: the business suffix is removed. */
export function displayRoleName(stored: string, businessId: number): string {
  const suffix = `${SEPARATOR}${businessId}`;
  if (stored.endsWith(suffix)) return stored.slice(0, -suffix.length);
  return stored.split(SEPARATOR)[0];
}

export function adminRoleName(businessId: number): string {
  return `Admin${SEPARATOR}${businessId}`;
}

export function isAdminRole(stored: string, businessId: number): boolean {
  return stored === adminRoleName(businessId);
}

/**
 * Laravel: a role flagged `is_default` (the Admin role) can be neither edited nor deleted, except the
 * Cashier role which is created as a default but stays editable.
 */
export function isRoleLocked(role: RoleLike, businessId: number): boolean {
  return role.is_default && role.name !== `Cashier${SEPARATOR}${businessId}`;
}

export function assertRoleEditable(role: RoleLike, businessId: number): void {
  if (isRoleLocked(role, businessId)) throw new ForbiddenException('This is a default role and cannot be changed');
}

export function assertRoleDeletable(role: RoleLike, businessId: number, assignedUsers: number): void {
  if (isRoleLocked(role, businessId)) throw new ForbiddenException('This is a default role and cannot be deleted');
  if (assignedUsers > 0) {
    throw new BadRequestException(`This role is assigned to ${assignedUsers} user${assignedUsers === 1 ? '' : 's'}. Move them to another role first`);
  }
}

/** Removes blanks and duplicates, keeping the first occurrence order. */
export function uniqueNames(names: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const n = (raw ?? '').trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Every submitted permission must be one this business can grant (blocks e.g. `superadmin` or typos). */
export function assertGrantable(names: readonly string[], grantable: ReadonlySet<string>): void {
  const unknown = names.filter((n) => !grantable.has(n));
  if (unknown.length > 0) throw new BadRequestException(`Unknown permission: ${unknown.slice(0, 5).join(', ')}`);
}

/** Radio groups allow a single choice (e.g. "view all" or "view own", never both). */
export function assertSingleChoice(names: readonly string[], radioOf: ReadonlyMap<string, string>): void {
  const seen = new Map<string, string>();
  for (const n of names) {
    const g = radioOf.get(n);
    if (!g) continue;
    const other = seen.get(g);
    if (other && other !== n) throw new BadRequestException(`Choose only one of ${other} and ${n}`);
    seen.set(g, n);
  }
}

/**
 * Permissions to store for a role after an edit: what was submitted, plus whatever the role already holds that
 * the editor could not show (hidden by a disabled module, legacy rows, module rows). Laravel silently dropped those.
 */
export function mergeRolePermissions(submitted: readonly string[], current: readonly string[], visible: ReadonlySet<string>): string[] {
  const kept = current.filter((n) => !visible.has(n));
  return uniqueNames([...submitted, ...kept]);
}

export interface SetDiff {
  add: string[];
  remove: string[];
}

/** What to insert and delete so that `current` becomes `next`. */
export function diffPermissionSets(current: readonly string[], next: readonly string[]): SetDiff {
  const cur = new Set(current);
  const nxt = new Set(next);
  return { add: [...nxt].filter((n) => !cur.has(n)), remove: [...cur].filter((n) => !nxt.has(n)) };
}
