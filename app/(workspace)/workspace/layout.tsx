import { redirect } from 'next/navigation';
import { WorkspaceChrome } from '@/components/workspace/WorkspaceChrome';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { toPersianDigits } from '@/src/lib/jalali.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }
  if (session.user.mustChangePassword) {
    redirect('/auth/change-password');
  }

  const platformConfig = await getPlatformSettings();

  return (
    <WorkspaceChrome
      user={{
        id: session.user.id,
        username: session.user.username,
        name: session.user.name,
        email: session.user.email,
        roles: session.access.roles,
        permissions: session.access.permissions,
      }}
      version={toPersianDigits(process.env.APP_VERSION || '0.1.0')}
      brandNameFa={platformConfig.settings.brandNameFa}
    >
      {children}
    </WorkspaceChrome>
  );
}
