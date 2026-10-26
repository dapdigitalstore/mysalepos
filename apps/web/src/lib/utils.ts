import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Currency display: Rs. 1,000.00 (Money is a decimal string from the API; never a float in business logic). */
export function formatMoney(value: string | number, locale = 'en-LK'): string {
  const n = typeof value === 'number' ? value : Number(value);
  return `Rs. ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)}`;
}
