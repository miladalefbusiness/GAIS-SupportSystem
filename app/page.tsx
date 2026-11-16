import type { Metadata } from 'next';
import { PublicShell } from '@/components/public/PublicShell';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { formatJalaliDate } from '@/src/lib/jalali.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';
import { listPublicDepartments } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getPlatformSettings();
  return {
    title: settings.siteTitleFa,
    description: settings.heroDescriptionFa,
    openGraph: {
      title: settings.siteTitleFa,
      description: settings.heroDescriptionFa,
      type: 'website',
      locale: 'fa_IR',
    },
  };
}

export default async function HomePage() {
  const [session, departments, platformConfig] = await Promise.all([
    getCurrentSession(),
    listPublicDepartments(),
    getPlatformSettings(),
  ]);

  const formattedDate = formatJalaliDate(new Date());
  const version = process.env.APP_VERSION || '0.1.0';

  return (
    <PublicShell
      isAuthenticated={Boolean(session)}
      formattedDate={formattedDate}
      version={version}
      departments={departments}
      settings={platformConfig.settings}
    />
  );
}
