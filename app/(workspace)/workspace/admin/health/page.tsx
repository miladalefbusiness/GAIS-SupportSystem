import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SystemHealthConsole } from '@/components/admin/SystemHealthConsole';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getSystemHealthDiagnostics } from '@/src/modules/admin/health.ts';

export const dynamic = 'force-dynamic';

export default async function AdminHealthPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const canView =
    hasPermission(session.access, 'admin:panel:access') ||
    hasPermission(session.access, 'admin:settings:manage') ||
    hasPermission(session.access, 'admin:storage:manage');

  if (!canView) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به سلامت سیستم (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مشاهده وضعیت زنده PostgreSQL، فضای ذخیره‌سازی و یکپارچه‌سازی‌ها به
            مجوز مدیریتی نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const diagnostics = await getSystemHealthDiagnostics();

  return <SystemHealthConsole initialData={diagnostics} />;
}
