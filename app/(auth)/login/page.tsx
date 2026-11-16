import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    if (session.user.mustChangePassword) {
      redirect('/change-password');
    }
    redirect('/workspace');
  }

  const { settings } = await getPlatformSettings();

  return <LoginForm brandNameFa={settings.brandNameFa} />;
}
