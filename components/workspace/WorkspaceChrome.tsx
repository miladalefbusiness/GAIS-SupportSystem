'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  FileSearch,
  FolderOpen,
  HardDrive,
  Headset,
  KeyRound,
  LogOut,
  Server,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export interface WorkspaceNavUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roles: Array<{ id: string; slug: string; nameFa: string }>;
  permissions: string[];
}

export function WorkspaceChrome({
  user,
  version,
  brandNameFa = 'پنل سازمانی پشتیبانی',
  children,
}: {
  user: WorkspaceNavUser;
  version: string;
  brandNameFa?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifs, setNotifs] = useState<
    Array<{
      id: string;
      ticketId: string | null;
      titleFa: string;
      bodyFa: string;
      isRead: boolean;
      createdAt: string;
    }>
  >([]);

  useEffect(() => {
    let active = true;
    fetch('/api/workspace/notifications')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setUnreadCount(Number(data.unreadCount ?? 0));
        setNotifs(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  async function handleMarkAllRead() {
    const res = await fetch('/api/workspace/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      setUnreadCount(Number(data.unreadCount ?? 0));
      setNotifs(Array.isArray(data.items) ? data.items : []);
    }
  }

  const canDesk = user.permissions.includes('desk:workspace:access');
  const canFiles = user.permissions.includes('files:workspace:access');
  const canDepartments = user.permissions.includes('admin:departments:manage');
  const canOperators = user.permissions.includes('admin:users:manage');
  const canRoles = user.permissions.includes('admin:roles:manage');
  const canKb =
    user.permissions.includes('kb:workspace:access') ||
    user.permissions.includes('kb:entries:manage');
  const canAiSettings = user.permissions.includes('ai:settings:manage');
  const canAiReports =
    user.permissions.includes('ai:reports:view') ||
    user.permissions.includes('ai:settings:manage');
  const canStorage =
    user.permissions.includes('admin:storage:manage') ||
    user.permissions.includes('files:quotas:manage');
  const canReports =
    user.permissions.includes('admin:panel:access') ||
    user.permissions.includes('admin:audit:view') ||
    user.permissions.includes('desk:tickets:view_all') ||
    user.permissions.includes('ai:reports:view');
  const canAudit = user.permissions.includes('admin:audit:view');
  const canSystemSettings = user.permissions.includes('admin:settings:manage');
  const canHealth =
    user.permissions.includes('admin:panel:access') ||
    user.permissions.includes('admin:settings:manage') ||
    user.permissions.includes('admin:storage:manage');

  const isDeskActive = pathname.startsWith('/workspace/desk');
  const isFilesActive = pathname.startsWith('/workspace/files');
  const isOverviewActive =
    pathname === '/workspace' || pathname.startsWith('/workspace/admin');

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
          <div className="flex items-center gap-6 overflow-x-auto">
            <Link
              href="/workspace"
              className="text-base font-bold text-slate-900 whitespace-nowrap shrink-0"
            >
              {brandNameFa}
            </Link>

            <nav
              aria-label="انتخاب فضای کاری"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 shrink-0"
            >
              <Link
                href="/workspace"
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  isOverviewActive
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                نمای کلی و مدیریت
              </Link>

              {canDesk ? (
                <Link
                  href="/workspace/desk"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    isDeskActive
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  میز پشتیبانی
                </Link>
              ) : (
                <span
                  title="بدون مجوز دسترسی به میز پشتیبانی"
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0 cursor-not-allowed"
                >
                  میز پشتیبانی
                </span>
              )}

              {canFiles ? (
                <Link
                  href="/workspace/files"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    isFilesActive
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  مخزن فایل اشتراکی
                </Link>
              ) : (
                <span
                  title="بدون مجوز دسترسی به مخزن فایل"
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0 cursor-not-allowed"
                >
                  مخزن فایل اشتراکی
                </span>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              type="button"
              aria-label="اعلان‌های تیکت"
              onClick={() => setNotifOpen((prev) => !prev)}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
            >
              <Bell className="h-4 w-4 text-slate-700" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -left-1 min-w-4 h-4 px-1 rounded-full bg-blue-700 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute left-0 top-12 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-900">
                    اعلان‌های اخیر تیکت
                  </span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleMarkAllRead()}
                      className="text-[11px] text-blue-700 hover:underline cursor-pointer"
                    >
                      علامت‌گذاری خوانده‌شده
                    </button>
                  )}
                </div>
                {notifs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    اعلان جدیدی ثبت نشده است.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1.5">
                    {notifs.slice(0, 10).map((n) => (
                      <Link
                        key={n.id}
                        href={
                          n.ticketId
                            ? `/workspace/desk/tickets/${n.ticketId}`
                            : '/workspace/desk'
                        }
                        onClick={() => setNotifOpen(false)}
                        className={`block rounded-lg p-2.5 text-xs border transition-colors ${
                          n.isRead
                            ? 'border-slate-100 bg-white text-slate-600'
                            : 'border-blue-100 bg-blue-50/50 text-slate-900'
                        }`}
                      >
                        <div className="font-semibold">{n.titleFa}</div>
                        <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                          {n.bodyFa}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="hidden sm:flex flex-col items-end text-xs">
              <span className="font-semibold text-slate-900">{user.name}</span>
              <span className="text-slate-500 font-[family-name:var(--font-mono)]">
                @{user.username}
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
                فضاهای عملیاتی
              </p>
              <Link
                href="/workspace"
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === '/workspace'
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>نمای کلی هسته</span>
              </Link>

              {canDesk && (
                <Link
                  href="/workspace/desk"
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isDeskActive
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Headset className="h-4 w-4 shrink-0" />
                  <span>دپارتمان‌های میز پشتیبانی</span>
                </Link>
              )}

              {canFiles && (
                <Link
                  href="/workspace/files"
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isFilesActive
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span>مخزن فایل اشتراکی</span>
                </Link>
              )}
            </div>

            {(canDepartments || canOperators || canRoles || canStorage) && (
              <div className="space-y-1">
                <p className="px-3 text-xs font-semibold text-slate-500">
                  مدیریت سازمان و دسترسی‌ها
                </p>
                {canDepartments && (
                  <Link
                    href="/workspace/admin/departments"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/departments')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span>مدیریت دپارتمان‌ها</span>
                  </Link>
                )}
                {canOperators && (
                  <Link
                    href="/workspace/admin/operators"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/operators')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span>مدیریت اپراتورها</span>
                  </Link>
                )}
                {canRoles && (
                  <Link
                    href="/workspace/admin/roles"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/roles')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Shield className="h-4 w-4 shrink-0" />
                    <span>نقش‌ها و مجوزها</span>
                  </Link>
                )}
                {canStorage && (
                  <Link
                    href="/workspace/admin/storage"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/storage')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <HardDrive className="h-4 w-4 shrink-0" />
                    <span>مدیریت ذخیره‌سازی و سهمیه‌ها</span>
                  </Link>
                )}
              </div>
            )}

            {(canKb || canAiSettings || canAiReports) && (
              <div className="space-y-1">
                <p className="px-3 text-xs font-semibold text-slate-500">
                  مخزن دانش و هوش مصنوعی
                </p>
                {canKb && (
                  <Link
                    href="/workspace/admin/knowledge"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/knowledge')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span>مخزن دانش</span>
                  </Link>
                )}
                {canAiSettings && (
                  <Link
                    href="/workspace/admin/ai-settings"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/ai-settings')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span>تنظیمات هوش مصنوعی</span>
                  </Link>
                )}
                {canAiReports && (
                  <Link
                    href="/workspace/admin/ai-reports"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/ai-reports')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <BarChart3 className="h-4 w-4 shrink-0" />
                    <span>گزارش‌های هوش مصنوعی</span>
                  </Link>
                )}
              </div>
            )}

            {(canReports || canAudit || canSystemSettings || canHealth) && (
              <div className="space-y-1">
                <p className="px-3 text-xs font-semibold text-slate-500">
                  مدیریت ارشد، گزارش‌ها و ممیزی
                </p>
                {canReports && (
                  <Link
                    href="/workspace/admin/reports"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/reports')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Activity className="h-4 w-4 shrink-0" />
                    <span>گزارش‌های عملیاتی</span>
                  </Link>
                )}
                {canAudit && (
                  <Link
                    href="/workspace/admin/audit"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/audit')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <FileSearch className="h-4 w-4 shrink-0" />
                    <span>ممیزی امنیتی</span>
                  </Link>
                )}
                {canSystemSettings && (
                  <Link
                    href="/workspace/admin/settings"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/settings')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <SlidersHorizontal className="h-4 w-4 shrink-0" />
                    <span>تنظیمات سامانه</span>
                  </Link>
                )}
                {canHealth && (
                  <Link
                    href="/workspace/admin/health"
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname.startsWith('/workspace/admin/health')
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Server className="h-4 w-4 shrink-0" />
                    <span>سلامت سیستم</span>
                  </Link>
                )}
              </div>
            )}

            <div className="space-y-1">
              <p className="px-3 text-xs font-semibold text-slate-500">
                حساب کاربری
              </p>
              <Link
                href="/auth/change-password"
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <KeyRound className="h-4 w-4 shrink-0" />
                <span>تغییر رمز عبور</span>
              </Link>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 px-2 text-xs text-slate-500 space-y-1">
            <div>نسخه سامانه: {version}</div>
            <div>مرحله: فاز ششم</div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 md:p-8 max-w-6xl space-y-6">
          {/* Mobile quick links */}
          <div className="flex lg:hidden items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 text-xs">
            <Link
              href="/workspace"
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
            >
              نمای کلی
            </Link>
            {canDesk && (
              <Link
                href="/workspace/desk"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                دپارتمان‌ها
              </Link>
            )}
            {canDepartments && (
              <Link
                href="/workspace/admin/departments"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                مدیریت دپارتمان‌ها
              </Link>
            )}
            {canOperators && (
              <Link
                href="/workspace/admin/operators"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                مدیریت اپراتورها
              </Link>
            )}
            {canRoles && (
              <Link
                href="/workspace/admin/roles"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                نقش‌ها و مجوزها
              </Link>
            )}
            {canKb && (
              <Link
                href="/workspace/admin/knowledge"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                مخزن دانش
              </Link>
            )}
            {canAiSettings && (
              <Link
                href="/workspace/admin/ai-settings"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                تنظیمات هوش مصنوعی
              </Link>
            )}
            {canStorage && (
              <Link
                href="/workspace/admin/storage"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                ذخیره‌سازی و سهمیه‌ها
              </Link>
            )}
            {canAiReports && (
              <Link
                href="/workspace/admin/ai-reports"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                گزارش‌های AI
              </Link>
            )}
            {canReports && (
              <Link
                href="/workspace/admin/reports"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                گزارش‌های عملیاتی
              </Link>
            )}
            {canAudit && (
              <Link
                href="/workspace/admin/audit"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                ممیزی امنیتی
              </Link>
            )}
            {canSystemSettings && (
              <Link
                href="/workspace/admin/settings"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                تنظیمات سامانه
              </Link>
            )}
            {canHealth && (
              <Link
                href="/workspace/admin/health"
                className="px-3 py-1.5 rounded-md bg-white border border-slate-200 whitespace-nowrap"
              >
                سلامت سیستم
              </Link>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
