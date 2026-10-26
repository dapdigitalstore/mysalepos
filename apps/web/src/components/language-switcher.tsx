'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';

const LABELS: Record<string, string> = { en: 'English', si: 'සිංහල' };

export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const locale = useLocale();
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value })}
        className={
          dark
            ? 'rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-white'
            : 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-700'
        }
      >
        {Object.entries(LABELS).map(([code, label]) => (
          <option key={code} value={code} className="text-slate-900">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
