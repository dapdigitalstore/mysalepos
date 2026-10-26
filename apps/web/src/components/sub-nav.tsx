'use client';

import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export interface SubNavItem {
  href: string;
  label: string;
  /** Hide the tab when false (e.g. missing permission). */
  visible?: boolean;
}

/** Tab bar shown at the top of a module's pages. `href` is locale-less (e.g. /m/products/units). */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items
        .filter((i) => i.visible !== false)
        .map((i) => {
          const active = pathname === i.href || (i.href.length > 4 && pathname.startsWith(`${i.href}/`));
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active ? 'border-primary text-primary-dark' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {i.label}
            </Link>
          );
        })}
    </nav>
  );
}
