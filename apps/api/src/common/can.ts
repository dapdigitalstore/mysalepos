import type { AuthUser } from './types';

/**
 * Mirrors UltimatePOS Gate::before + Spatie: Superadmin passes everything, the business Admin role
 * passes everything except the `superadmin` ability, everyone else needs the permission explicitly.
 */
export function can(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>, permission: string): boolean {
  if (user.isSuperadmin) return true;
  if (permission === 'superadmin') return false;
  if (user.isAdmin) return true;
  return user.permissions.includes(permission);
}
