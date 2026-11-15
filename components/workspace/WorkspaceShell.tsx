'use client';

import { useState } from 'react';
import {
  Activity,
  BookOpen,
  Building2,
  FolderOpen,
  HardDrive,
  Headset,
  KeyRound,
  LogOut,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytesFa, formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';

export interface WorkspaceOverviewData {
  user: {
    id: string;
    username: string;
    name: string;
    email: string;
    authMethod: string;
    roles: Array<{ id: string; slug: string; nameFa: string }>;
    permissions: string[];
  };
  foundation: {
    phase: number;
    version: string;
    databaseOk: boolean;
    counts: { users: number; roles: number };
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

type ActiveTab = 'overview' | 'desk' | 'files';

export function WorkspaceShell({ data }: { data: WorkspaceOverviewData }) {
  const router = useRouter();
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveTab>('overview');
  const [loggingOut, setLoggingOut] = useState(false);

  const canDesk = data.user.permissions.includes('desk:workspace:access');
  const canFiles = data.user.permissions.includes('files:workspace:access');
  const canAudit = data.user.permissions.includes('admin:audit:view');
  const canStorage = data.user.permissions.includes('admin:storage:manage');

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      toast.success('خروج با موفقیت انجام شد.');
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('خطا در خروج از سامانه.');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar with Dual Workspace Switcher */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 px-6 h-16">
          <div className="flex items-center gap-6">
            <Link
              href="/workspace"
              className="text-base font-bold text-slate-900 whitespace-nowrap shrink-0"
            >
              پنل سازمانی پشتیبانی
            </Link>

            <nav
              aria-label="انتخاب فضای کاری"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1"
            >
              <button
                type="button"
                onClick={() => setActiveWorkspace('overview')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeWorkspace === 'overview'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                هسته سامانه
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkspace('desk')}
                disabled={!canDesk}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  activeWorkspace === 'desk'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                میز پشتیبانی
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkspace('files')}
                disabled={!canFiles}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  activeWorkspace === 'files'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                مخزن فایل اشتراکی
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex flex-col items-end text-xs">
              <span className="font-semibold text-slate-900">{data.user.name}</span>
              <span className="text-slate-500 font-[family-name:var(--font-mono)]">
                @{data.user.username}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut className="h-4 w-4" />
              <span>خروج</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Right-Side RTL Navigation Sidebar */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white p-4 justify-between">
          <div className="space-y-6">
            <div className="space-y-1">
              <p className="px-3 text-xs font-semibold text-slate-500">
                ماژول‌های فعال (فاز ۱)
              </p>
              <button
                type="button"
                onClick={() => setActiveWorkspace('overview')}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                  activeWorkspace === 'overview'
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Activity className="h-4 w-4 shrink-0" />
                <span>نمای کلی هسته و امنیت</span>
              </button>
              <Link
                href="/auth/change-password"
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <KeyRound className="h-4 w-4 shrink-0" />
                <span>تغییر رمز عبور</span>
              </Link>
            </div>

            <div className="space-y-1">
              <p className="px-3 text-xs font-semibold text-slate-500">
                در انتظار فازهای بعدی
              </p>
              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    دپارتمان‌ها
                  </span>
                  <span>فاز ۲</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    اپراتورها و نقش‌ها
                  </span>
                  <span>فاز ۲</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    مخزن دانش
                  </span>
                  <span>فاز ۳</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    تنظیمات هوش مصنوعی
                  </span>
                  <span>فاز ۳</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Headset className="h-4 w-4" />
                    تیکت‌های پشتیبانی
                  </span>
                  <span>فاز ۴</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    مدیریت فایل‌ها
                  </span>
                  <span>فاز ۵</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 px-2 text-xs text-slate-500 space-y-1">
            <div>نسخه سامانه: {toPersianDigits(data.foundation.version)}</div>
            <div>مرحله: فاز اول (پایه و استقرار)</div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 md:p-8 max-w-6xl space-y-6">
          {activeWorkspace === 'desk' && (
            <Card>
              <CardHeader>
                <CardTitle>فضای میز پشتیبانی</CardTitle>
                <CardDescription>
                  دسترسی شما به فضای میز پشتیبانی در RBAC تایید شده است. مدیریت
                  صف تیکت‌ها، دپارتمان‌ها و ارجاع از فاز ۲ و ۴ فعال خواهد شد.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {activeWorkspace === 'files' && (
            <Card>
              <CardHeader>
                <CardTitle>فضای مخزن فایل اشتراکی</CardTitle>
                <CardDescription>
                  زیرساخت ذخیره‌سازی خارج از ریشه وب آماده است. مدیریت پوشه‌ها،
                  آپلود امن و دسترسی دپارتمانی در فاز ۵ فعال می‌شود.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {activeWorkspace === 'overview' && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold text-slate-900">
                    نمای کلی هسته سامانه
                  </h1>
                  <p className="text-sm text-slate-600">
                    وضعیت واقعی اتصال پایگاه داده، ذخیره‌سازی پایدار و سطح دسترسی
                    حساب کاربری شما
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/">مشاهده پورتال عمومی</Link>
                </Button>
              </div>

              {/* System Metrics Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>وضعیت PostgreSQL</CardDescription>
                    <CardTitle className="text-lg">
                      {data.foundation.databaseOk ? 'متصل و آماده' : 'قطع'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-500 tabular-nums">
                    {toPersianDigits(data.foundation.counts.users)} کاربر ·{' '}
                    {toPersianDigits(data.foundation.counts.roles)} نقش سیستمی
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>نقش‌های کاربری شما</CardDescription>
                    <CardTitle className="text-lg">
                      {data.user.roles.map((r) => r.nameFa).join('، ') || 'بدون نقش'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-500 tabular-nums">
                    {toPersianDigits(data.user.permissions.length)} مجوز فعال
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>ذخیره‌سازی پایدار</CardDescription>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-blue-700" />
                      <span>
                        {canStorage
                          ? data.foundation.storage?.ok
                            ? 'آماده نوشتن'
                            : 'خطا'
                          : 'محدودشده'}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-500 tabular-nums">
                    {canStorage && data.foundation.quotas[0]
                      ? `سقف کل: ${formatBytesFa(data.foundation.quotas[0].maxBytes)}`
                      : 'نیازمند مجوز admin:storage:manage'}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>شیوه احراز هویت نشست</CardDescription>
                    <CardTitle className="text-lg font-[family-name:var(--font-mono)]">
                      {data.user.authMethod}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-slate-500">
                    نشست ذخیره‌شده در پایگاه داده
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
                    فهرست کلیدهای کنشی مجاز برای نشست فعلی بر اساس نقش‌ها و
                    استثناهای فردی در PostgreSQL
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.user.permissions.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      هنوز هیچ مجوز عملیاتی برای این حساب تخصیص داده نشده است
                      (سیاست پیش‌فرض مسدود).
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {data.user.permissions.map((perm) => (
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

              {/* Audit Logs Viewer (only when authorized) */}
              {canAudit && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      آخرین رویدادهای ممیزی امنیتی
                    </CardTitle>
                    <CardDescription>
                      ثبت خودکار بوت‌استرپ، ورودها و تغییرات امنیتی (بدون افشای رمز یا
                      کد ملی)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {data.recentAudit.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        هنوز رویدادی ثبت نشده است.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-xs text-slate-500">
                              <th className="py-2.5 px-3 font-medium">رویداد</th>
                              <th className="py-2.5 px-3 font-medium">نوع عامل</th>
                              <th className="py-2.5 px-3 font-medium">هدف</th>
                              <th className="py-2.5 px-3 font-medium">نشانی IP</th>
                              <th className="py-2.5 px-3 font-medium">زمان (شمسی)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.recentAudit.map((row) => (
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}
