import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SharedFilesWorkspace } from '@/components/files/SharedFilesWorkspace';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listFileHubWorkspace } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export default async function SharedFilesWorkspacePage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  if (session.user.mustChangePassword) redirect('/change-password');

  const canAccess =
    session.access.isSuperAdmin ||
    hasPermission(session.access, 'files:items:manage_all') ||
    (hasPermission(session.access, 'files:workspace:access') &&
      hasPermission(session.access, 'files:items:view'));

  if (!canAccess) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مخزن فایل اشتراکی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            حساب کاربری شما مجوز ورود و مشاهده فضای مخزن فایل (`files:workspace:access` و
            `files:items:view`) را ندارد.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const initialData = await listFileHubWorkspace(session.access, {});

  return <SharedFilesWorkspace initialData={initialData} />;
}
