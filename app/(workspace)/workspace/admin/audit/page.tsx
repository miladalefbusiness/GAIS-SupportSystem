import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuditLogViewer } from '@/components/admin/AuditLogViewer';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listAuditLogsAdmin } from '@/src/modules/admin/audit.ts';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'admin:audit:view')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به گزارش‌های ممیزی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مشاهده رویدادهای ممیزی امنیتی و خروجی لاگ‌ها به مجوز{' '}
            <code dir="ltr">admin:audit:view</code> نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const auditData = await listAuditLogsAdmin({ page: 1, pageSize: 25 });

  return <AuditLogViewer initialData={auditData} />;
}
