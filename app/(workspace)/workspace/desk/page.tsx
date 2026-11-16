import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DeskTicketsConsole } from '@/components/workspace/DeskTicketsConsole';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { listAuthorizedDepartmentsForOperator } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export default async function SupportDeskIndexPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'desk:workspace:access')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">عدم دسترسی به میز پشتیبانی</CardTitle>
          </div>
          <CardDescription className="text-red-700">
            حساب کاربری شما مجوز ورود به فضای میز پشتیبانی (`desk:workspace:access`) را
            ندارد.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const authorizedDepts = await listAuthorizedDepartmentsForOperator(
    session.access
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">میز پشتیبانی سازمانی</h1>
        <p className="text-sm text-slate-600">
          فقط تیکت‌ها و دپارتمان‌هایی که عضو مجاز آن‌ها هستید (یا با مجوز مشاهده کل سازمان) در این بخش نمایش داده می‌شوند.
        </p>
      </div>

      {authorizedDepts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-sm text-slate-600 leading-relaxed">
            شما هنوز به هیچ دپارتمانی تخصیص داده نشده‌اید. برای عضویت در دپارتمان‌ها با
            مدیر ارشد سامانه هماهنگ کنید.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {authorizedDepts.map((dept) => (
              <Link
                key={dept.id}
                href={`/workspace/desk/${dept.id}`}
                className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-600 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                      <DepartmentIcon iconKey={dept.iconKey} className="h-4 w-4 text-blue-700" />
                    </div>
                    <ArrowLeft className="h-4 w-4 text-slate-400 group-hover:text-blue-700" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {dept.nameFa}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {dept.descriptionFa || 'صف پاسخگویی دپارتمان'}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>{dept.isActive ? 'فعال' : 'غیرفعال'}</span>
                  <span>{dept.isManager ? 'مدیر دپارتمان' : 'اپراتور'}</span>
                </div>
              </Link>
            ))}
          </div>

          <DeskTicketsConsole title="صف یکپارچه تیکت‌های مجاز" />
        </>
      )}
    </div>
  );
}

