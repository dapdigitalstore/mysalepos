import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Card } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default function LoginPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = useTranslations();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-navy-900 to-navy-700 p-4">
      <div className="mb-6 text-center text-white">
        <h1 className="text-3xl font-semibold">{t('app.name')}</h1>
        <p className="mt-1 text-white/70">{t('app.tagline')}</p>
      </div>
      <Card className="w-full max-w-sm p-6">
        <h2 className="text-xl font-semibold text-slate-900">{t('login.title')}</h2>
        <p className="mb-5 mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>
        <LoginForm />
      </Card>
      <div className="mt-6">
        <LanguageSwitcher dark />
      </div>
    </div>
  );
}
