export interface Access {
  isAdmin: boolean;
  isSuperadmin: boolean;
  permissions: string[];
}

/** Same rule as the API (apps/api/src/common/can.ts). Only used to hide controls; the API enforces it. */
export function can(user: Access, permission: string): boolean {
  if (user.isSuperadmin) return true;
  if (permission === 'superadmin') return false;
  if (user.isAdmin) return true;
  return user.permissions.includes(permission);
}
