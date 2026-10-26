import { can } from '../common/can';
import type { AuthUser } from '../common/types';
import { MODULES, type ModuleManifest } from './manifest';

/** Parses business.enabled_modules (a JSON array stored as text); null/invalid means "no toggles set". */
export function parseEnabledFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Modules the user should see in the menu: core modules respect the business feature toggles,
 * and every module needs one of its permissions (Admin/Superadmin see all they are allowed to).
 */
export function visibleModules(user: AuthUser, enabledFeatures: string[], all: ModuleManifest[] = MODULES): ModuleManifest[] {
  return all.filter((m) => {
    if (m.featureKey && !enabledFeatures.includes(m.featureKey)) return false;
    if (m.permissions.length === 0) return true;
    return m.permissions.some((p) => can(user, p));
  });
}
