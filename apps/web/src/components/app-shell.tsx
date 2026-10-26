'use client';

import { LogOut, Menu, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';
import { ModuleIcon } from './module-icon';

export interface NavModule {
  id: string;
  kind: 'core' | 'addon';
  icon: string;
  name: { en: string; si: string };
  status: 'done' | 'in-progress' | 'planned';
}

interface Props {
  modules: NavModule[];
  businessName: string;
  userName: string;
  children: React.ReactNode;
}

export function AppShell({ modules, businessName, userName, children }: Props) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'si';
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const href = (m: NavModule) => (m.id === 'dashboard' ? '/' : `/m/${m.id}`);
  const isActive = (m: NavModule) => (m.id === 'dashboard' ? pathname === '/' : pathname === `/m/${m.id}` || pathname.startsWith(`/m/${m.id}/`));
  const core = modules.filter((m) => m.kind === 'core');
  const addons = modules.filter((m) => m.kind === 'addon');

  const renderGroup = (label: string, items: NavModule[]) =>
    items.length > 0 && (
      <div className="mt-5">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-white/40">{label}</p>
        <ul className="space-y-0.5">
          {items.map((m) => (
            <li key={m.id}>
              <Link
                href={href(m)}
                onClick={() => setOpen(false)}
                aria-current={isActive(m) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive(m) ? 'bg-primary text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
                )}
              >
                <ModuleIcon name={m.icon} className="h-4 w-4 shrink-0" />
                <span className="truncate">{m.name[locale]}</span>
                {m.status === 'planned' && <span className="ms-auto h-1.5 w-1.5 rounded-full bg-amber-400" title={t('module.comingSoon')} />}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="min-h-screen lg:flex">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-64 flex-col bg-navy-800 p-3 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 rtl:lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-lg font-semibold text-white">{t('app.name')}</span>
          <button className="text-white/70 lg:hidden" onClick={() => setOpen(false)} aria-label={t('nav.closeMenu')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto pb-4" aria-label="Main">
          {renderGroup(t('nav.core'), core)}
          {renderGroup(t('nav.addons'), addons)}
        </nav>
        <div className="border-t border-white/10 pt-3">
          <LanguageSwitcher dark />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-medium text-slate-700">{businessName}</p>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{userName}</span>
            <form action="/api/session/logout" method="post">
              <button type="submit" className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{t('nav.logout')}</span>
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
