import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AiReportsViewer } from '@/components/admin/AiReportsViewer';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listAiReportsAdmin } from '@/src/modules/ai/chat.ts';

export const dynamic = 'force-dynamic';

export default async function AdminAiReportsPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const canView =
    hasPermission(session.access, 'ai:reports:view') ||
    hasPermission(session.access, 'ai:settings:manage');

  if (!canView) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به گزارش‌های هوش مصنوعی (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مشاهده گزارش‌های مصرف و ردیابی منابع به مجوز `ai:reports:view` یا `ai:settings:manage` نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const reports = await listAiReportsAdmin();

  return (
    <AiReportsViewer
      usageLogs={reports.usageLogs}
      retrievalRecords={reports.retrievalRecords}
    />
  );
}
