import { BadRequestException } from '@nestjs/common';
import { FEATURE_KEYS, REFERENCE_TYPES } from './business-settings.dto';

/** Keeps only known feature keys; unknown ones are an error (a typo must not silently switch a feature off). */
export function validateEnabledModules(keys: string[]): string[] {
  const unknown = keys.filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) throw new BadRequestException(`Unknown feature: ${unknown.join(', ')}`);
  return keys;
}

/** Prefixes: only known document types, short text, empty -> null. Returns the JSON to store. */
export function validateRefPrefixes(input: Record<string, string | null>): string {
  const out: Record<string, string | null> = {};
  for (const [type, value] of Object.entries(input)) {
    if (!(REFERENCE_TYPES as readonly string[]).includes(type)) throw new BadRequestException(`Unknown document type: ${type}`);
    if (value != null && typeof value !== 'string') throw new BadRequestException(`Prefix for ${type} must be text`);
    const v = value?.trim() ?? '';
    if (v.length > 10) throw new BadRequestException(`Prefix for ${type} is too long (max 10 characters)`);
    out[type] = v === '' ? null : v;
  }
  return JSON.stringify(out);
}

/** stop_selling_before only matters when products stop selling before expiry; Laravel clears it for keep_selling. */
export function stopSellingBeforeFor(onProductExpiry: string | undefined, value: number | null | undefined): number | undefined {
  if (onProductExpiry === 'keep_selling') return 0;
  return value ?? undefined;
}
