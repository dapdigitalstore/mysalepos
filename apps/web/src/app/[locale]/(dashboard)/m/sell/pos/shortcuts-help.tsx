'use client';

import { Keyboard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { PAYMENT_SHORTCUTS, SCREEN_SHORTCUTS, SHORTCUTS, prettyCombo, type ShortcutId } from '../_lib/shortcuts';

interface Props {
  open: boolean;
  onToggle: (open: boolean) => void;
}

/** Popover with the list of keyboard shortcuts (F1 toggles it). */
export function ShortcutsHelp({ open, onToggle }: Props) {
  const t = useTranslations('pos');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);

  const row = (id: ShortcutId) => (
    <li key={id} className="flex items-center justify-between gap-4 py-1">
      <span className="text-slate-700">{t(`shortcut.${id}`)}</span>
      <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700">{prettyCombo(SHORTCUTS[id])}</kbd>
    </li>
  );

  return (
    <div ref={ref} className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => onToggle(!open)} aria-expanded={open} aria-haspopup="true">
        <Keyboard className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('shortcuts')}</span>
      </Button>
      {open && (
        <div role="dialog" aria-label={t('shortcuts')} className="absolute end-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="mb-1 text-sm font-semibold text-slate-900">{t('shortcuts')}</p>
          <ul className="text-sm">{SCREEN_SHORTCUTS.map(row)}</ul>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('shortcutsPayment')}</p>
          <ul className="text-sm">{PAYMENT_SHORTCUTS.map(row)}</ul>
          <p className="mt-3 text-xs text-slate-500">{t('shortcutsBarcode')}</p>
        </div>
      )}
    </div>
  );
}
