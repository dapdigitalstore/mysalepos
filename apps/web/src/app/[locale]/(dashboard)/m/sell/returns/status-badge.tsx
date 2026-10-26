import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { PaymentStatus } from './return-types';

const TONES: Record<PaymentStatus, string> = {
  paid: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  due: 'bg-red-50 text-red-700',
};

const KEYS: Record<PaymentStatus, 'statusPaid' | 'statusPartial' | 'statusDue'> = {
  paid: 'statusPaid',
  partial: 'statusPartial',
  due: 'statusDue',
};

/** Payment status of a return (refund) or of a sale. */
export function StatusBadge({ status }: { status: PaymentStatus | null }) {
  const t = useTranslations('sellReturns');
  if (!status) return null;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONES[status])}>{t(KEYS[status])}</span>;
}
