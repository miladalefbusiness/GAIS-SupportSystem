import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getCurrentSession } from '@/src/core/auth/auth.ts';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    if (session.user.mustChangePassword) {
      redirect('/auth/change-password');
    }
    redirect('/workspace');
  }

  return <LoginForm />;
}
