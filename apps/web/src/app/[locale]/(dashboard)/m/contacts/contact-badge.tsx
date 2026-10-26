import { cn } from '@/lib/utils';

export function Badge({ tone, children }: { tone: 'red' | 'blue' | 'slate' | 'green'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-50 text-red-700',
    blue: 'bg-sky-50 text-sky-700',
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
  } as const;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}
