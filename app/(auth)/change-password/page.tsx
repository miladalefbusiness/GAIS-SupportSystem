import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { getCurrentSession } from '@/src/core/auth/auth.ts';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <ChangePasswordForm
      username={session.user.username}
      forced={session.user.mustChangePassword}
    />
  );
}
