/** Types that are numbered without the year, e.g. CO0001. Everything else is PREFIX + year + / + 4 digits. */
const NO_YEAR_TYPES = new Set(['contacts', 'business_location', 'username']);

/**
 * Same format as Laravel `Util::generateReferenceNumber`:
 *   contacts / business_location / username -> <prefix><0001>
 *   everything else (invoice, purchase ...)  -> <prefix><year>/<0001>
 */
export function formatReferenceNumber(type: string, count: number, prefix: string | null | undefined, year: number): string {
  const digits = String(count).padStart(4, '0');
  const p = prefix ?? '';
  return NO_YEAR_TYPES.has(type) ? `${p}${digits}` : `${p}${year}/${digits}`;
}

/** business.ref_no_prefixes is a JSON object stored as text, e.g. {"contacts":"CO","purchase":"PO"}. */
export function prefixFor(rawPrefixes: string | null | undefined, type: string): string {
  if (!rawPrefixes) return '';
  try {
    const parsed: unknown = JSON.parse(rawPrefixes);
    const v = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[type] : undefined;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
