import { ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PrintableTicketReport } from '@/components/admin/PrintableTicketReport';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import {
  getOperationalReports,
  parseReportWindowDays,
} from '@/src/modules/admin/reports.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';

export const dynamic = 'force-dynamic';

export default async function AdminPrintableReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; departmentId?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const canView =
    hasPermission(session.access, 'admin:panel:access') ||
    hasPermission(session.access, 'admin:audit:view') ||
    hasPermission(session.access, 'desk:tickets:view_all') ||
    hasPermission(session.access, 'ai:reports:view');

  if (!canView) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              عدم دسترسی به گزارش چاپی عملکرد (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700">
            برای مشاهده و چاپ خلاصه گزارش تیکت‌ها و زمان حل اپراتورها به مجوز
            مدیریتی گزارش‌ها نیاز دارید.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const resolvedSearchParams = await searchParams;
  const days = parseReportWindowDays(resolvedSearchParams.days, 30);
  const departmentId = resolvedSearchParams.departmentId?.trim() || undefined;

  const [reports, platformConfig] = await Promise.all([
    getOperationalReports({ days, departmentId }),
    getPlatformSettings(),
  ]);

  return (
    <PrintableTicketReport
      initialData={reports}
      organizationNameFa={platformConfig.settings.organizationNameFa}
      brandNameFa={platformConfig.settings.brandNameFa}
      generatedByName={`${session.user.name} (@${session.user.username})`}
      generatedAtIso={new Date().toISOString()}
    />
  );
}
