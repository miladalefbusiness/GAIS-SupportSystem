'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  HardDrive,
  Headset,
  Loader2,
  PauseCircle,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatBytesFa, formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';
import type { DepartmentTicketQueueSummaryResult } from '@/src/modules/tickets/service';
import { DepartmentTicketStatsWidget } from './DepartmentTicketStatsWidget';

export interface OverviewPanelProps {
  user: {
    id: string;
    username: string;
    name: string;
    email: string;
    authMethod: string;
    isAvailable: boolean;
    roles: Array<{ id: string; slug: string; nameFa: string }>;
    permissions: string[];
    departments: Array<{
      departmentId: string;
      slug: string;
      nameFa: string;
      isManager: boolean;
    }>;
  };
  foundation: {
    databaseOk: boolean;
    counts: { users: number; roles: number; departments: number };
    storage: {
      ok: boolean;
      driver: string;
      writable: boolean;
    } | null;
    quotas: Array<{
      id: string;
      scopeType: string;
      driver: string;
      maxBytes: number;
      usedBytes: number;
    }>;
  };
  recentAudit: Array<{
    id: string;
    action: string;
    actorType: string;
    targetType: string | null;
    ipAddress: string | null;
    createdAt: string;
  }>;
  departmentTicketSummary: DepartmentTicketQueueSummaryResult;
}

const ACTOR_LABELS: Record<string, string> = {
  user: 'کاربر سازمانی',
  system: 'سیستم',
  anonymous: 'بازدیدکننده',
  customer: 'مشتری',
};

export function OverviewPanel({
  user,
  foundation,
  recentAudit,
  departmentTicketSummary,
}: OverviewPanelProps) {
  const [available, setAvailable] = useState(user.isAvailable);
  const [updatingAvail, setUpdatingAvail] = useState(false);
  const [showPermissionsDetail, setShowPermissionsDetail] = useState(false);

  const canAudit = user.permissions.includes('admin:audit:view');
  const canStorage = user.permissions.includes('admin:storage:manage');
  const canDesk = user.permissions.includes('desk:workspace:access');
  const canFiles = user.permissions.includes('files:workspace:access');
  const canAdminSettings = user.permissions.includes('admin:settings:manage');
  const canAdminDepartments = user.permissions.includes('admin:departments:manage');

  async function toggleAvailability() {
    const next = !available;
    setUpdatingAvail(true);
    try {
      const res = await fetch('/api/workspace/availability', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: next }),
      });
      if (!res.ok) {
        toast.error('خطا در تغییر وضعیت حضور.');
        return;
      }
      setAvailable(next);
      toast.success(
        next
          ? 'وضعیت شما به «آماده پاسخگویی» تغییر یافت.'
          : 'وضعیت شما به «غیرفعال موقت» تغییر یافت.'
      );
    } catch {
      toast.error('ارتباط با سرور برقرار نشد.');
    } finally {
      setUpdatingAvail(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            خوش آمدید، {user.name}
          </h1>
          <p className="text-sm text-slate-600">
            داشبورد عملیاتی و دسترسی سریع به بخش‌های پشتیبانی و مدیریت
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant={available ? 'outline' : 'secondary'}
            size="sm"
            onClick={toggleAvailability}
            disabled={updatingAvail}
          >
            {updatingAvail ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : available ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            ) : (
              <PauseCircle className="h-4 w-4 text-amber-700" />
            )}
            <span>{available ? 'وضعیت: آماده پاسخگویی' : 'وضعیت: غیرفعال موقت'}</span>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/">پورتال مشتریان</Link>
          </Button>
        </div>
      </div>

      {/* Quick Action Workspaces */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {canDesk && (
          <Link
            href="/workspace/desk"
            className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-500 transition-colors flex items-start justify-between gap-3"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Headset className="h-4 w-4 text-blue-700" />
                <span>میز پشتیبانی و تیکت‌ها</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                مدیریت صف پاسخگویی، گفتگو با مشتریان و پیگیری تیکت‌های دپارتمان‌ها
              </p>
            </div>
            <ArrowLeft className="h-4 w-4 text-slate-400 group-hover:text-blue-700 shrink-0 mt-0.5 transition-colors" />
          </Link>
        )}

        {canFiles && (
          <Link
            href="/workspace/files"
            className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-500 transition-colors flex items-start justify-between gap-3"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FolderOpen className="h-4 w-4 text-blue-700" />
                <span>مخزن فایل اشتراکی</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                دسترسی به پوشه‌ها، بارگذاری و اشتراک‌گذاری اسناد دپارتمانی
              </p>
            </div>
            <ArrowLeft className="h-4 w-4 text-slate-400 group-hover:text-blue-700 shrink-0 mt-0.5 transition-colors" />
          </Link>
        )}

        {(canAdminDepartments || canAdminSettings) && (
          <Link
            href={
              canAdminDepartments
                ? '/workspace/admin/departments'
                : '/workspace/admin/settings'
            }
            className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-500 transition-colors flex items-start justify-between gap-3"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <SlidersHorizontal className="h-4 w-4 text-blue-700" />
                <span>مدیریت و پیکربندی</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                تنظیم دپارتمان‌ها، کاربران، مخزن دانش و ظاهر پورتال پشتیبانی
              </p>
            </div>
            <ArrowLeft className="h-4 w-4 text-slate-400 group-hover:text-blue-700 shrink-0 mt-0.5 transition-colors" />
          </Link>
        )}
      </div>

      {/* System Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>وضعیت سرویس و پایگاه داده</CardDescription>
            <CardTitle className="text-lg">
              {foundation.databaseOk ? 'متصل و آماده' : 'عدم اتصال'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(foundation.counts.departments)} دپارتمان ·{' '}
            {toPersianDigits(foundation.counts.users)} کاربر ·{' '}
            {toPersianDigits(foundation.counts.roles)} نقش
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>نقش‌های کاربری شما</CardDescription>
            <CardTitle className="text-lg">
              {user.roles.map((r) => r.nameFa).join('، ') || 'بدون نقش'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(user.permissions.length)} مجوز فعال
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>دپارتمان‌های مجاز</CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-700" />
              <span className="tabular-nums">
                {user.permissions.includes('desk:tickets:view_all')
                  ? 'کل سازمان'
                  : `${toPersianDigits(user.departments.length)} دپارتمان`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {user.departments.length > 0
              ? user.departments.map((d) => d.nameFa).slice(0, 2).join('، ')
              : canDesk
              ? 'آماده پاسخگویی در صف مجاز'
              : 'بدون دپارتمان اختصاصی'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ذخیره‌سازی فایل</CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-700" />
              <span>
                {canStorage
                  ? foundation.storage?.ok
                    ? 'آماده و پایدار'
                    : 'نیازمند بررسی'
                  : foundation.storage?.ok
                  ? 'فعال'
                  : 'محدودشده'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {canStorage && foundation.quotas[0]
              ? `ظرفیت کل: ${formatBytesFa(foundation.quotas[0].maxBytes)}`
              : 'سهمیه بر اساس سیاست سازمانی'}
          </CardContent>
        </Card>
      </div>

      {/* Department Open & Awaiting Reply Ticket Widget */}
      {departmentTicketSummary.authorized && (
        <DepartmentTicketStatsWidget
          initialSummary={departmentTicketSummary}
          canAdminDepartments={canAdminDepartments}
          databaseOk={foundation.databaseOk}
        />
      )}

      {/* Collapsible Permissions Summary */}
      <Card>
        <CardHeader className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-700 shrink-0" />
              <div>
                <CardTitle className="text-sm">
                  سطح دسترسی و مجوزهای فعال حساب کاربری
                </CardTitle>
                <CardDescription className="text-xs">
                  مجموع {toPersianDigits(user.permissions.length)} مجوز برای نشست فعلی
                  شما فعال است
                </CardDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPermissionsDetail((prev) => !prev)}
            >
              <span>{showPermissionsDetail ? 'بستن فهرست' : 'نمایش کلیدهای مجوز'}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  showPermissionsDetail ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </div>
        </CardHeader>
        {showPermissionsDetail && (
          <CardContent className="pt-0">
            {user.permissions.length === 0 ? (
              <p className="text-sm text-slate-500">
                هنوز هیچ مجوز عملیاتی برای این حساب تخصیص داده نشده است.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {user.permissions.map((perm) => (
                  <div
                    key={perm}
                    dir="ltr"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-[family-name:var(--font-mono)] text-slate-700"
                  >
                    {perm}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Audit Logs Viewer */}
      {canAudit && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">آخرین رویدادهای ممیزی امنیتی</CardTitle>
              <CardDescription>
                ثبت خودکار تغییرات دپارتمان‌ها، اپراتورها، نقش‌ها و ورودها
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/workspace/admin/audit">مشاهده کامل و فیلتر</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentAudit.length === 0 ? (
              <p className="text-sm text-slate-500">هنوز رویدادی ثبت نشده است.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">رویداد</th>
                      <th className="py-2.5 px-3 font-medium">عامل</th>
                      <th className="py-2.5 px-3 font-medium">هدف</th>
                      <th className="py-2.5 px-3 font-medium">نشانی IP</th>
                      <th className="py-2.5 px-3 font-medium">زمان (شمسی)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentAudit.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td
                          dir="ltr"
                          className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-800 text-right"
                        >
                          {row.action}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600">
                          {ACTOR_LABELS[row.actorType] || row.actorType}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600">
                          {row.targetType || '—'}
                        </td>
                        <td
                          dir="ltr"
                          className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-600 text-right tabular-nums"
                        >
                          {row.ipAddress || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatJalaliDateTime(row.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
