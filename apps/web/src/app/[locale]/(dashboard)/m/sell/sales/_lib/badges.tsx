import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DisplayPaymentStatus } from './sale-types';

const PILL = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

const PAYMENT_TONE: Record<DisplayPaymentStatus, string> = {
  paid: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  due: 'bg-red-50 text-red-700',
  overdue: 'bg-red-100 text-red-800',
  'partial-overdue': 'bg-orange-100 text-orange-800',
};

const PAYMENT_KEY: Record<DisplayPaymentStatus, string> = {
  paid: 'payPaid',
  partial: 'payPartial',
  due: 'payDue',
  overdue: 'payOverdue',
  'partial-overdue': 'payPartialOverdue',
};

/** Payment status as the list shows it (`displayPaymentStatus` already includes overdue). */
export function PaymentBadge({ status }: { status: DisplayPaymentStatus | null }) {
  const t = useTranslations('sales');
  if (!status) return <span className="text-slate-400">-</span>;
  return <span className={cn(PILL, PAYMENT_TONE[status])}>{t(PAYMENT_KEY[status])}</span>;
}

const SHIPPING_TONE: Record<string, string> = {
  ordered: 'bg-slate-100 text-slate-700',
  packed: 'bg-sky-50 text-sky-700',
  shipped: 'bg-indigo-50 text-indigo-700',
  delivered: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

export function ShippingBadge({ status }: { status: string | null }) {
  const t = useTranslations('sales');
  if (!status) return <span className="text-slate-400">-</span>;
  const known = status in SHIPPING_TONE;
  return <span className={cn(PILL, known ? SHIPPING_TONE[status] : 'bg-slate-100 text-slate-700')}>{known ? t(`ship_${status}`) : status}</span>;
}

/** draft / quotation / proforma / suspended / final, for the detail header and the drafts lists. */
export function KindBadge({ status, subStatus, isSuspend }: { status: string; subStatus: string | null; isSuspend: boolean }) {
  const t = useTranslations('sales');
  if (isSuspend) return <span className={cn(PILL, 'bg-violet-50 text-violet-700')}>{t('kindSuspended')}</span>;
  if (status === 'draft') {
    if (subStatus === 'quotation') return <span className={cn(PILL, 'bg-sky-50 text-sky-700')}>{t('kindQuotation')}</span>;
    if (subStatus === 'proforma') return <span className={cn(PILL, 'bg-indigo-50 text-indigo-700')}>{t('kindProforma')}</span>;
    return <span className={cn(PILL, 'bg-slate-100 text-slate-700')}>{t('kindDraft')}</span>;
  }
  return <span className={cn(PILL, 'bg-emerald-50 text-emerald-700')}>{t('kindFinal')}</span>;
}
