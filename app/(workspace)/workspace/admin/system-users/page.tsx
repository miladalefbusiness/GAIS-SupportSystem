import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SystemUsersManager } from '@/components/admin/SystemUsersManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listSystemUsersAdmin } from '@/src/modules/customers/admin.ts';

export const dynamic = 'force-dynamic';

export default async function AdminSystemUsersPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!session.access.isSuperAdmin || !hasPermission(session.access, 'admin:users:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مدیریت کاربران سامانه (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            مشاهده و مدیریت کاربران سامانه فقط در اختیار سوپرادمین سامانه است.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const users = await listSystemUsersAdmin();

  return <SystemUsersManager initialUsers={users} />;
}
