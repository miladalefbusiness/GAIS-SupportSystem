import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { formatJalaliDate } from '@/src/lib/jalali.ts';
import { PublicShell } from '@/components/public/PublicShell';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getCurrentSession();
  const formattedDate = formatJalaliDate(new Date());
  const version = process.env.APP_VERSION || '0.1.0';

  return (
    <PublicShell
      isAuthenticated={Boolean(session)}
      formattedDate={formattedDate}
      version={version}
    />
  );
}
