'use client';

import { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  HardDrive,
  Loader2,
  PauseCircle,
  Shield,
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
}

export function OverviewPanel({
  user,
  foundation,
  recentAudit,
}: OverviewPanelProps) {
  const [available, setAvailable] = useState(user.isAvailable);
  const [updatingAvail, setUpdatingAvail] = useState(false);

  const canAudit = user.permissions.includes('admin:audit:view');
  const canStorage = user.permissions.includes('admin:storage:manage');
  const canDesk = user.permissions.includes('desk:workspace:access');

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
        next ? 'وضعیت شما به «آماده پاسخگویی» تغییر یافت.' : 'وضعیت شما به «غیرفعال موقت» تغییر یافت.'
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
          <h1 className="text-2xl font-bold text-slate-900">نمای کلی هسته سامانه</h1>
          <p className="text-sm text-slate-600">
            وضعیت پایگاه داده، دپارتمان‌های مجاز، سطح دسترسی و رویدادهای ممیزی
          </p>
        </div>

        <div className="flex items-center gap-2.5">
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
            <Link href="/">پورتال عمومی</Link>
          </Button>
        </div>
      </div>

      {/* System Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>وضعیت PostgreSQL</CardDescription>
            <CardTitle className="text-lg">
              {foundation.databaseOk ? 'متصل و آماده' : 'قطع'}
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
                  ? 'دسترسی کل سازمان'
                  : `${toPersianDigits(user.departments.length)} دپارتمان`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {canDesk ? (
              <Link href="/workspace/desk" className="text-blue-700 hover:underline">
                مشاهده میز پشتیبانی
              </Link>
            ) : (
              'بدون دسترسی به میز پشتیبانی'
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ذخیره‌سازی پایدار</CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-700" />
              <span>
                {canStorage
                  ? foundation.storage?.ok
                    ? 'آماده نوشتن'
                    : 'خطا'
                  : 'محدودشده'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {canStorage && foundation.quotas[0]
              ? `سقف کل: ${formatBytesFa(foundation.quotas[0].maxBytes)}`
              : 'نیازمند مجوز admin:storage:manage'}
          </CardContent>
        </Card>
      </div>

      {/* Effective Permissions Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-base">
              مجوزهای موثر حساب کاربری (محاسبه‌شده در سرور)
            </CardTitle>
          </div>
          <CardDescription>
            فهرست کلیدهای کنشی مجاز برای نشست فعلی بر اساس نقش‌ها و استثناهای فردی
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.permissions.length === 0 ? (
            <p className="text-sm text-slate-500">
              هنوز هیچ مجوز عملیاتی برای این حساب تخصیص داده نشده است (سیاست پیش‌فرض
              مسدود).
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
      </Card>

      {/* Audit Logs Viewer */}
      {canAudit && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                          {row.actorType}
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
                        <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums">
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
