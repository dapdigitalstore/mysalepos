import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isAdminRole } from '../roles/role.rules';

/** Laravel's client-side validation: passwords and usernames are at least 5 characters. */
export const MIN_PASSWORD = 5;
export const MIN_USERNAME = 5;
/** bcrypt only looks at the first 72 bytes, so longer passwords would silently be cut. */
export const MAX_PASSWORD_BYTES = 72;

export function fullName(p: { surname?: string | null; first_name?: string | null; last_name?: string | null }): string {
  return [p.surname, p.first_name, p.last_name]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** PHP `!empty()` on a `system` property: null, '', and '0' are off. */
export function isTruthySetting(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== '' && value !== '0';
}

/** With the `enable_business_based_username` system setting usernames end in `-<business id, 2 digits>`. */
export function usernameSuffix(businessId: number, enabled: boolean): string {
  return enabled ? `-${String(businessId).padStart(2, '0')}` : '';
}

/** Adds the business suffix once (editing a username that already carries it must not double it). */
export function applyUsernameSuffix(username: string, suffix: string): string {
  return suffix && !username.endsWith(suffix) ? `${username}${suffix}` : username;
}

export function validatePassword(password: string): string {
  if (password.length < MIN_PASSWORD) throw new BadRequestException(`Password must be at least ${MIN_PASSWORD} characters`);
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new BadRequestException(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  return password;
}

export function cleanUsername(raw: string): string {
  const username = raw.trim();
  if (username.length < MIN_USERNAME) throw new BadRequestException(`Username must be at least ${MIN_USERNAME} characters`);
  if (/\s/.test(username)) throw new BadRequestException('Username cannot contain spaces');
  return username;
}

export interface LoginInput {
  allowLogin: boolean;
  username?: string | null;
  password?: string | null;
}

export interface LoginContext {
  suffix: string;
  isNew: boolean;
  /** Username the user already has (edit only). */
  existingUsername?: string | null;
  /** The user already has a password (edit only). */
  hasPassword: boolean;
}

/**
 * What to store for the login part of a user.
 *  - login not allowed: no username and no password (Laravel clears both).
 *  - login allowed: `username` is final (suffix applied) or null when one must be generated;
 *    `password` is the new plain password or null to keep the current one.
 */
export type LoginPlan = { allowLogin: false } | { allowLogin: true; username: string | null; password: string | null };

export function planLogin(input: LoginInput, ctx: LoginContext): LoginPlan {
  if (!input.allowLogin) return { allowLogin: false };
  const typedUsername = (input.username ?? '').trim();
  const typedPassword = input.password ?? '';

  let username: string | null;
  if (typedUsername) username = applyUsernameSuffix(cleanUsername(typedUsername), ctx.suffix);
  else username = ctx.existingUsername ? ctx.existingUsername : null;

  let password: string | null = null;
  if (typedPassword) password = validatePassword(typedPassword);
  else if (ctx.isNew || !ctx.hasPassword) throw new BadRequestException('Password is required when login is allowed');

  return { allowLogin: true, username, password };
}

/** Commission percent: users.cmmsn_percent is DECIMAL(4,2), so 0 to 99.99 with at most two decimals. */
export function cleanCommissionPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const d = decimalOrThrow(value, 'Commission percent');
  if (d.lt(0) || d.gt('99.99')) throw new BadRequestException('Commission percent must be between 0 and 99.99');
  return d.toFixed(2);
}

/** Maximum sales discount percent: DECIMAL(5,2); null means no limit. */
export function cleanMaxDiscountPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = decimalOrThrow(value, 'Maximum sales discount');
  if (d.lt(0) || d.gt(100)) throw new BadRequestException('Maximum sales discount must be between 0 and 100');
  return d.toFixed(2);
}

function decimalOrThrow(value: number, label: string): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${label} is not a number`);
  }
  if (!d.isFinite()) throw new BadRequestException(`${label} is not a number`);
  if (d.decimalPlaces() > 2) throw new BadRequestException(`${label} can have at most two decimals`);
  return d;
}

export interface DeleteUserCheck {
  actorId: number;
  targetId: number;
  targetIsAdmin: boolean;
  /** Active users that hold the business Admin role. */
  adminCount: number;
}

export function assertUserDeletable(c: DeleteUserCheck): void {
  if (c.actorId === c.targetId) throw new ForbiddenException('You cannot delete your own account');
  if (c.targetIsAdmin && c.adminCount <= 1) throw new BadRequestException('The only admin user cannot be deleted');
}

export interface RoleChangeCheck {
  previousRoleId: number;
  newRoleId: number;
  targetIsAdmin: boolean;
  adminCount: number;
}

/** Laravel (lang_v1.cannot_change_role): the last admin keeps the Admin role. */
export function assertRoleChangeAllowed(c: RoleChangeCheck): void {
  if (c.previousRoleId !== c.newRoleId && c.targetIsAdmin && c.adminCount <= 1) {
    throw new BadRequestException('The role of the only admin user cannot be changed');
  }
}

/** Only admins may hand out the Admin role (non-admins do not even see it in the dropdown). */
export function assertRoleAssignable(role: { name: string }, businessId: number, actorIsAdmin: boolean): void {
  if (isAdminRole(role.name, businessId) && !actorIsAdmin) throw new ForbiddenException('Only an admin can assign the Admin role');
}

/** A non-admin with `user.update` must not be able to take over an Admin account (password, email, role). */
export function assertCanManageTarget(targetIsAdmin: boolean, actorIsAdmin: boolean): void {
  if (targetIsAdmin && !actorIsAdmin) throw new ForbiddenException('Only an admin can change or delete an admin user');
}

/** People must not lock themselves out by editing their own account. */
export function assertSelfEditSafe(c: { actorId: number; targetId: number; allowLogin: boolean; status: string }): void {
  if (c.actorId === c.targetId && (!c.allowLogin || c.status !== 'active')) {
    throw new BadRequestException('You cannot disable login or deactivate your own account');
  }
}

/** Same as Laravel's "deactivated users cannot sign in": `terminated` and `inactive` both block login in auth. */
export const USER_STATUSES = ['active', 'inactive', 'terminated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ---- bank details (users.bank_details holds a JSON object) ----

export interface BankDetails {
  accountHolderName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  branch: string;
  taxPayerId: string;
}

const BANK_KEYS: [keyof BankDetails, string][] = [
  ['accountHolderName', 'account_holder_name'],
  ['accountNumber', 'account_number'],
  ['bankName', 'bank_name'],
  ['bankCode', 'bank_code'],
  ['branch', 'branch'],
  ['taxPayerId', 'tax_payer_id'],
];

export function blankBankDetails(): BankDetails {
  return { accountHolderName: '', accountNumber: '', bankName: '', bankCode: '', branch: '', taxPayerId: '' };
}

/** JSON to store with Laravel's snake_case keys; null when nothing was filled in. */
export function serializeBankDetails(b: Partial<BankDetails> | null | undefined): string | null {
  if (!b) return null;
  const out: Record<string, string> = {};
  for (const [camel, snake] of BANK_KEYS) {
    const v = (b[camel] ?? '').trim();
    if (v) out[snake] = v;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

export function parseBankDetails(raw: string | null | undefined): BankDetails {
  const out = blankBankDetails();
  if (!raw) return out;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') {
      for (const [camel, snake] of BANK_KEYS) {
        const x = (v as Record<string, unknown>)[snake];
        if (typeof x === 'string') out[camel] = x;
      }
    }
  } catch {
    // stored text is not JSON: show nothing rather than failing the page
  }
  return out;
}

// ---- date of birth ----

/** `YYYY-MM-DD` -> Date at UTC midnight (the column is a DATE). */
export function parseDob(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Date of birth must be a valid date (YYYY-MM-DD)');
  }
  if (d.getTime() > Date.now()) throw new BadRequestException('Date of birth cannot be in the future');
  return d;
}

export function formatDob(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// ---- location access (permissions given straight to the user) ----

export const ALL_LOCATIONS_PERMISSION = 'access_all_locations';
const LOCATION_PERMISSION = /^location\.(\d+)$/;

export const locationPermission = (id: number) => `location.${id}`;

export interface LocationAccess {
  all: boolean;
  ids: number[];
}

export function locationAccessOf(permissionNames: readonly string[]): LocationAccess {
  const ids = permissionNames
    .map((n) => LOCATION_PERMISSION.exec(n)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  return { all: permissionNames.includes(ALL_LOCATIONS_PERMISSION), ids: [...new Set(ids)].sort((a, b) => a - b) };
}

/** Every chosen location must belong to the business. */
export function assertLocationsValid(access: LocationAccess, validIds: ReadonlySet<number>): void {
  if (access.all) return;
  const bad = access.ids.filter((i) => !validIds.has(i));
  if (bad.length > 0) throw new BadRequestException(`Unknown location: ${bad.join(', ')}`);
}

/**
 * What to grant and revoke so the user ends up with exactly this location access.
 * "All locations" replaces the individual ones (Laravel left them behind, which only caused confusion later).
 */
export function planLocationPermissions(current: readonly string[], access: LocationAccess): { grant: string[]; revoke: string[] } {
  const desired = access.all ? [ALL_LOCATIONS_PERMISSION] : [...new Set(access.ids)].map(locationPermission);
  const held = current.filter((n) => n === ALL_LOCATIONS_PERMISSION || LOCATION_PERMISSION.test(n));
  return {
    grant: desired.filter((n) => !held.includes(n)),
    revoke: held.filter((n) => !desired.includes(n)),
  };
}
