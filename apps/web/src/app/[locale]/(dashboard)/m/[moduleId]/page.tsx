import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ModuleIcon } from '@/components/module-icon';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { apiGet, type ModuleInfo } from '@/lib/api';

export default async function ModulePage({ params: { locale, moduleId } }: { params: { locale: 'en' | 'si'; moduleId: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations('module');
  const modules = await apiGet<ModuleInfo[]>('/modules');
  const mod = modules.find((m) => m.id === moduleId);
  if (!mod) notFound();
  const name = mod.name[locale];

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-primary-light p-3 text-primary-dark">
            <ModuleIcon name={mod.icon} className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{t('plannedTitle', { name })}</h1>
            <p className="text-sm text-slate-500">{t('phase', { phase: mod.phase })}</p>
          </div>
        </div>
        <p className="mt-4 text-slate-600">{t('plannedBody', { phase: mod.phase })}</p>
        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('scope')}</h2>
        <ul className="space-y-2">
          {mod.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-primary-dark hover:underline">
          {t('back')}
        </Link>
      </Card>
    </div>
  );
}
