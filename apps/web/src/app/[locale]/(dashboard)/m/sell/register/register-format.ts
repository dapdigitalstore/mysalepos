import { useLocale } from 'next-intl';

/** next-intl locale -> BCP 47 tag used for dates (Sinhala as spoken in Sri Lanka). */
export function dateLocale(locale: string): string {
  return locale === 'si' ? 'si-LK' : 'en-GB';
}

/** `2026-10-15T08:23:00.000Z` -> "15 Oct 2026, 13:53" in the business time zone. Empty for null. */
export function formatDateTime(value: string | null | undefined, timeZone: string, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(dateLocale(locale), { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Hook form of formatDateTime that picks up the current UI language. */
export function useDateTimeFormatter(timeZone: string) {
  const locale = useLocale();
  return (value: string | null | undefined) => formatDateTime(value, timeZone, locale);
}

/** Quantities come as decimal strings with up to 4 decimals: drop trailing zeros. */
export function formatQuantity(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n);
}
