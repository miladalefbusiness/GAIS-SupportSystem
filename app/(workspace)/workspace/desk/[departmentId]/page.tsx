import { ArrowRight, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DeskTicketsConsole } from '@/components/workspace/DeskTicketsConsole';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { canAccessDepartment, hasPermission } from '@/src/core/auth/rbac.ts';
import { toPersianDigits } from '@/src/lib/jalali.ts';
import { getAuthorizedDepartmentDetails } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

const STRATEGY_LABEL: Record<string, string> = {
  round_robin: 'توزیع نوبتی (Round-Robin)',
  least_loaded: 'توزیع بر اساس کمترین بار کاری',
  manual_queue: 'صف دستی بدون ارجاع خودکار',
};

export default async function DepartmentDeskDetailPage({
  params,
}: {
  params: Promise<{ departmentId: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const { departmentId } = await params;

  if (
    !hasPermission(session.access, 'desk:workspace:access') ||
    !canAccessDepartment(session.access, departmentId)
  ) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">
              دسترسی غیرمجاز به دپارتمان (۴۰۳)
            </CardTitle>
          </div>
          <CardDescription className="text-red-700 leading-relaxed">
            شما عضو این دپارتمان نیستید و مجوز مشاهده تیکت‌ها یا اطلاعات این واحد را
            ندارید. دسترسی‌های دپارتمانی در سرور کنترل می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/workspace/desk">بازگشت به دپارتمان‌های مجاز</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const details = await getAuthorizedDepartmentDetails(departmentId);
  if (!details) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">دپارتمان یافت نشد</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/workspace/desk">بازگشت</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { department, members } = details;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white border border-slate-200">
            <DepartmentIcon iconKey={department.iconKey} className="h-5 w-5 text-blue-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{department.nameFa}</h1>
            <p className="text-xs text-slate-500 font-[family-name:var(--font-mono)]">
              {department.slug}
            </p>
          </div>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/workspace/desk">
            <ArrowRight className="h-4 w-4" />
            <span>همه دپارتمان‌های مجاز</span>
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>سیاست تخصیص تیکت</CardDescription>
            <CardTitle className="text-base">
              {STRATEGY_LABEL[department.assignmentStrategy] ||
                department.assignmentStrategy}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>دستیار هوشمند</CardDescription>
            <CardTitle className="text-base">
              {department.aiEnabled ? 'فعال در دپارتمان' : 'غیرفعال'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>سقف پیوست دپارتمان</CardDescription>
            <CardTitle className="text-base tabular-nums">
              {toPersianDigits(department.maxUploadSizeMb)} مگابایت
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-base">اپراتورهای عضو دپارتمان</CardTitle>
          </div>
          <CardDescription>
            اعضای مجاز این دپارتمان و ظرفیت تیکت هم‌زمان هر اپراتور
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-slate-500">
              هنوز اپراتوری به این دپارتمان تخصیص داده نشده است.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-3 font-medium">نام اپراتور</th>
                    <th className="py-2.5 px-3 font-medium">نام کاربری</th>
                    <th className="py-2.5 px-3 font-medium">نقش در دپارتمان</th>
                    <th className="py-2.5 px-3 font-medium">وضعیت حضور</th>
                    <th className="py-2.5 px-3 font-medium">سقف تیکت فعال</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {m.name}
                      </td>
                      <td
                        dir="ltr"
                        className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-600 text-right"
                      >
                        @{m.username}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700">
                        {m.isManager ? 'مدیر دپارتمان' : 'اپراتور'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700">
                        {m.userStatus !== 'active'
                          ? 'حساب غیرفعال'
                          : m.globalAvailable && m.membershipAvailable
                          ? 'آماده پاسخگویی'
                          : 'غیرفعال موقت'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700 tabular-nums">
                        {toPersianDigits(m.maxActiveTickets)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DeskTicketsConsole
        departmentId={department.id}
        title={`صف تیکت‌های دپارتمان ${department.nameFa}`}
      />
    </div>
  );
}
