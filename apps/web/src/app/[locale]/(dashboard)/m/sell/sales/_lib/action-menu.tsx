'use client';

import { MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** Locale-less app path. Items with `href` render as links. */
  href?: string;
  /** Open the link in a new tab (print views). */
  newTab?: boolean;
  onSelect?: () => void;
  danger?: boolean;
  /** false hides the item (missing permission, wrong state). */
  show?: boolean;
}

const ITEM_CLASS = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none';

/**
 * Row actions menu. The table wrapper scrolls horizontally (and so clips absolutely positioned children), so the
 * menu is rendered in a portal with fixed coordinates taken from the trigger button.
 */
export function ActionMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const t = useTranslations('sales');
  const visible = items.filter((i) => i.show !== false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const placed = pos !== null;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const width = 224;
    const rtl = document.documentElement.dir === 'rtl';
    let left = rtl ? b.left : b.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: b.bottom + 4, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Flip above the button when the menu would leave the viewport.
  useLayoutEffect(() => {
    if (!open || !menu.current || !pos) return;
    const h = menu.current.offsetHeight;
    const b = button.current?.getBoundingClientRect();
    if (b && pos.top + h > window.innerHeight - 8 && b.top - h - 4 > 8) setPos({ top: b.top - h - 4, left: pos.left });
  }, [open, placed, visible.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        button.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const idx = els.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % els.length : (idx - 1 + els.length) % els.length;
        els[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setPos(null);
    // focus the first item once, when the menu has been placed
    else if (placed) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, placed]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('rowActions')}: ${label}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`${t('rowActions')}: ${label}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: 224 }}
            className="z-50 rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
          >
            {visible.map((i) =>
              i.href ? (
                <Link
                  key={i.key}
                  href={i.href}
                  role="menuitem"
                  target={i.newTab ? '_blank' : undefined}
                  rel={i.newTab ? 'noopener' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(ITEM_CLASS, i.danger && 'text-red-600')}
                >
                  {i.icon}
                  {i.label}
                </Link>
              ) : (
                <button
                  key={i.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    i.onSelect?.();
                  }}
                  className={cn(ITEM_CLASS, i.danger && 'text-red-600')}
                >
                  {i.icon}
                  {i.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
