import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SystemSettingsManager } from '@/components/admin/SystemSettingsManager';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'admin:settings:manage')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به تنظیمات سامانه (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای ویرایش تنظیمات عمومی، برندینگ و پیش‌فرض‌های سامانه به مجوز{' '}
            <code dir="ltr">admin:settings:manage</code> نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = await getPlatformSettings();

  return (
    <SystemSettingsManager
      initialSettings={data.settings}
      initialUpdatedAt={data.updatedAt}
    />
  );
}
