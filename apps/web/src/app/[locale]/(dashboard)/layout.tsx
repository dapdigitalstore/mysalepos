import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import { apiGet, type MeResponse, type ModuleInfo } from '@/lib/api';

// Everything under the dashboard depends on the signed-in user's cookie, so never prerender it.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  const [me, modules] = await Promise.all([apiGet<MeResponse>('/auth/me'), apiGet<ModuleInfo[]>('/modules')]);

  return (
    <Providers user={me.user}>
      <AppShell
        modules={modules}
        businessName={me.business?.name ?? ''}
        userName={`${me.user.firstName} ${me.user.lastName}`.trim()}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
