import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { StorageAdminManager } from '@/components/admin/StorageAdminManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import {
  canManageStorageAdmin,
  getStorageAdminOverview,
} from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export default async function AdminStoragePage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  if (session.user.mustChangePassword) redirect('/auth/change-password');

  if (!canManageStorageAdmin(session.access)) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به مدیریت ذخیره‌سازی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مدیریت سهمیه‌ها و سیاست فایل‌ها نیاز به مجوز `admin:storage:manage` یا
            `files:quotas:manage` دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const initialOverview = await getStorageAdminOverview(session.access);

  return <StorageAdminManager initialOverview={initialOverview} />;
}
