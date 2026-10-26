import type { AuthUser } from '../../../common/types';

const LOCATION_PERMISSION = /^location\.(\d+)$/;

/**
 * Which business locations a user may work with (Laravel `permitted_locations`):
 * Admin / Superadmin / `access_all_locations` -> every location ('all'),
 * otherwise only the ones granted through `location.<id>` permissions.
 */
export function permittedLocationIds(user: Pick<AuthUser, 'isAdmin' | 'isSuperadmin' | 'permissions'>): 'all' | number[] {
  if (user.isAdmin || user.isSuperadmin || user.permissions.includes('access_all_locations')) return 'all';
  return user.permissions
    .map((p) => LOCATION_PERMISSION.exec(p)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number);
}
