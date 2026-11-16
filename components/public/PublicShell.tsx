'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  FolderLock,
  Headset,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
import {
  CustomerAuthDialog,
  type VerifiedCustomerDto,
} from '@/components/public/CustomerAuthDialog';
import { CustomerTicketsPortal } from '@/components/public/CustomerTicketsPortal';
import { DepartmentChatDialog } from '@/components/public/DepartmentChatDialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DEFAULT_PLATFORM_SETTINGS,
  type PlatformSettingsDto,
  type ThemeAccentPreset,
} from '@/src/modules/admin/settings-schema';
import type { PublicDepartmentCard } from '@/src/modules/departments/service';
import type { CustomerTicketSummaryDto } from '@/src/modules/tickets/service';

interface PublicShellProps {
  isAuthenticated: boolean;
  formattedDate: string;
  version: string;
  departments: PublicDepartmentCard[];
  settings?: PlatformSettingsDto;
}

const ACCENT_ICON_CLASSES: Record<ThemeAccentPreset, string> = {
  blue: 'text-blue-700',
  indigo: 'text-indigo-700',
  emerald: 'text-emerald-700',
  slate: 'text-slate-700',
};

const ACCENT_BORDER_HOVER: Record<ThemeAccentPreset, string> = {
  blue: 'hover:border-blue-600 focus-visible:ring-blue-600',
  indigo: 'hover:border-indigo-600 focus-visible:ring-indigo-600',
  emerald: 'hover:border-emerald-600 focus-visible:ring-emerald-600',
  slate: 'hover:border-slate-700 focus-visible:ring-slate-700',
};

const ACCENT_BADGE_BG: Record<ThemeAccentPreset, string> = {
  blue: 'group-hover:bg-blue-50',
  indigo: 'group-hover:bg-indigo-50',
  emerald: 'group-hover:bg-emerald-50',
  slate: 'group-hover:bg-slate-200',
};

const WORKSPACES = [
  {
    title: 'پورتال عمومی پشتیبانی و تیکتینگ',
    phase: 'فاز ۱ تا ۴ فعال',
    description:
      'انتخاب پویا دپارتمان‌ها، دستیار هوشمند متکی بر مخزن دانش، احراز هویت کد ملی + کد یک‌بارمصرف و ثبت و پیگیری تیکت با پیوست امن.',
    icon: Headset,
  },
  {
    title: 'میز کار اپراتورها',
    phase: 'فاز ۲ و ۴ فعال',
    description:
      'مدیریت صف تیکت‌های دپارتمان، توزیع خودکار عادلانه بین کارشناسان، یادداشت‌های داخلی محرمانه و انتقال بین دپارتمان‌ها.',
    icon: Building2,
  },
  {
    title: 'مخزن فایل اشتراکی',
    phase: 'فاز ۵ فعال',
    description:
      'کتابخانه ساختاریافته اسناد سازمانی با پوشه‌بندی سلسله‌مراتبی، کنترل دسترسی دپارتمانی، سهمیه حجمی و ممیزی دانلود.',
    icon: FolderLock,
  },
  {
    title: 'پنل مدیریت ارشد',
    phase: 'فاز ۱ تا ۶ فعال',
    description:
      'مدیریت دپارتمان‌ها، اپراتورها، نقش‌ها، مخزن دانش، تنظیمات سامانه و AI، گزارش‌های جامع عملیاتی، ممیزی امنیتی و سلامت سیستم.',
    icon: SlidersHorizontal,
  },
];

export function PublicShell({
  isAuthenticated,
  formattedDate,
  version,
  departments,
  settings = DEFAULT_PLATFORM_SETTINGS,
}: PublicShellProps) {
  const accentIcon = ACCENT_ICON_CLASSES[settings.themeAccent] || ACCENT_ICON_CLASSES.blue;
  const accentHover =
    ACCENT_BORDER_HOVER[settings.themeAccent] || ACCENT_BORDER_HOVER.blue;
  const accentBadgeBg = ACCENT_BADGE_BG[settings.themeAccent] || ACCENT_BADGE_BG.blue;
  const [selectedDepartment, setSelectedDepartment] =
    useState<PublicDepartmentCard | null>(null);
  const [customer, setCustomer] = useState<VerifiedCustomerDto | null>(null);
  const [customerTickets, setCustomerTickets] = useState<
    CustomerTicketSummaryDto[]
  >([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [pendingHandoffConvId, setPendingHandoffConvId] = useState<string | null>(
    null
  );

  const refreshCustomerSession = useCallback(async () => {
    try {
      const res = await fetch('/api/public/customer/me');
      if (!res.ok) {
        setCustomer(null);
        setCustomerTickets([]);
        return;
      }
      const data = await res.json();
      setCustomer(data.customer ?? null);
      const list: CustomerTicketSummaryDto[] = Array.isArray(data.tickets)
        ? data.tickets
        : [];
      setCustomerTickets(list);
      setSelectedTicketId((prev) => prev ?? list[0]?.id ?? null);
    } catch {
      // Ignore silent check errors on public page load
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/public/customer/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setCustomer(data.customer ?? null);
        const list: CustomerTicketSummaryDto[] = Array.isArray(data.tickets)
          ? data.tickets
          : [];
        setCustomerTickets(list);
        if (list.length > 0) {
          setSelectedTicketId((prev) => prev ?? list[0].id);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function handleCustomerVerified(verified: VerifiedCustomerDto) {
    setCustomer(verified);

    if (pendingHandoffConvId) {
      const convId = pendingHandoffConvId;
      setPendingHandoffConvId(null);
      try {
        const res = await fetch('/api/public/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiConversationId: convId }),
        });
        const data = await res.json();
        if (res.ok && data.ticket) {
          toast.success(
            `تیکت پشتیبانی با کد ${data.ticket.referenceCode} از گفت‌وگوی شما ایجاد شد.`
          );
          setSelectedDepartment(null);
          await refreshCustomerSession();
          setSelectedTicketId(data.ticket.id);
          document
            .getElementById('customer-portal')
            ?.scrollIntoView({ behavior: 'smooth' });
          return;
        }
      } catch {
        // Fall back to standard refresh
      }
    }

    await refreshCustomerSession();
    document
      .getElementById('customer-portal')
      ?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleCustomerLogout() {
    await fetch('/api/public/customer/logout', { method: 'POST' });
    setCustomer(null);
    setCustomerTickets([]);
    setSelectedTicketId(null);
    toast.success('خروج از حساب مشتری انجام شد.');
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {settings.brandNameFa}
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#departments"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              دپارتمان‌ها
            </a>
            <a
              href="#customer-portal"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              تیکت‌های من
            </a>
            {settings.showWorkspacesSummary && (
              <a
                href="#workspaces"
                className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                فضاهای کاری
              </a>
            )}
            <a
              href="#security"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              اصول امنیتی
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (customer) {
                  document
                    .getElementById('customer-portal')
                    ?.scrollIntoView({ behavior: 'smooth' });
                } else {
                  setPendingHandoffConvId(null);
                  setAuthDialogOpen(true);
                }
              }}
            >
              <Ticket className={`h-4 w-4 ${accentIcon}`} />
              <span>{customer ? customer.fullName : 'پیگیری تیکت مشتری'}</span>
            </Button>
            <Button asChild size="sm">
              <Link href={isAuthenticated ? '/workspace' : '/login'}>
                {isAuthenticated ? 'ورود به میز کار' : 'ورود کارکنان'}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {settings.maintenanceNoticeFa.trim() && (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-amber-900"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2.5 text-xs md:text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            <span>{settings.maintenanceNoticeFa}</span>
          </div>
        </div>
      )}

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-14 md:py-20">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="max-w-3xl space-y-5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span>فاز ششم: مدیریت ارشد، گزارش‌های جامع و ممیزی</span>
                <span aria-hidden="true">·</span>
                <span className="font-[family-name:var(--font-mono)] tabular-nums">
                  v{version}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formattedDate}</span>
              </div>

              <h1 className="text-3xl md:text-5xl font-bold leading-tight text-slate-900 [text-wrap:balance]">
                {settings.heroTitleFa}
              </h1>

              <p className="text-base md:text-lg leading-relaxed text-slate-600">
                {settings.heroDescriptionFa}
              </p>

              {settings.supportContactText.trim() && (
                <p className="text-xs font-medium text-slate-500">
                  {settings.supportContactText}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button asChild size="lg">
                  <a href="#departments">انتخاب دپارتمان پشتیبانی</a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    if (customer) {
                      document
                        .getElementById('customer-portal')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    } else {
                      setPendingHandoffConvId(null);
                      setAuthDialogOpen(true);
                    }
                  }}
                >
                  {customer ? 'مشاهده تیکت‌های من' : 'ورود مشتری و پیگیری تیکت'}
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Dynamic Departments Grid (Loaded from PostgreSQL) */}
        <section id="departments" className="mx-auto max-w-6xl px-6 py-14">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold text-slate-900">
                دپارتمان‌های پشتیبانی
              </h2>
              <p className="text-sm text-slate-600">
                بخش مربوط به درخواست خود را انتخاب کنید تا گفت‌وگو با دستیار هوشمند یا
                ارجاع به اپراتور آغاز شود.
              </p>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {departments.length} دپارتمان فعال
            </span>
          </div>

          {departments.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Building2 className="h-4 w-4 text-blue-700 shrink-0" />
                    <span>هنوز دپارتمان فعالی منتشر نشده است</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">
                    مدیر ارشد می‌تواند از بخش «مدیریت دپارتمان‌ها» در پنل کاربری،
                    دپارتمان‌های جدید را ایجاد و فعال کند تا بلافاصله در این صفحه
                    نمایش داده شوند.
                  </p>
                </div>
                <Button asChild variant="secondary">
                  <Link
                    href={
                      isAuthenticated
                        ? '/workspace/admin/departments'
                        : '/login'
                    }
                  >
                    مدیریت دپارتمان‌ها
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelectedDepartment(dept)}
                  className={`group text-right rounded-xl border border-slate-200 bg-white p-6 transition-colors ${accentHover} focus-visible:outline-none focus-visible:ring-2 cursor-pointer flex flex-col justify-between gap-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 ${accentBadgeBg} transition-colors`}
                      >
                        <DepartmentIcon
                          iconKey={dept.iconKey}
                          className={`h-5 w-5 ${accentIcon}`}
                        />
                      </div>
                      <ArrowLeft
                        className={`h-4 w-4 text-slate-400 group-hover:${accentIcon} transition-colors`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-base font-semibold text-slate-900">
                        {dept.nameFa}
                      </h3>
                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                        {dept.descriptionFa ||
                          'پاسخگویی و پشتیبانی تخصصی در این دپارتمان'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 pt-3 border-t border-slate-100">
                    <span>
                      {dept.aiEnabled
                        ? 'دستیار هوشمند فعال'
                        : 'بدون دستیار هوشمند'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {dept.humanOperatorsAvailable
                        ? 'اپراتور انسانی آماده'
                        : 'صف انتظار اپراتور'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Customer OTP Ticket Portal */}
        <CustomerTicketsPortal
          departments={departments}
          customer={customer}
          tickets={customerTickets}
          selectedTicketId={selectedTicketId}
          onSelectTicket={setSelectedTicketId}
          onRefreshSession={refreshCustomerSession}
          onOpenAuth={() => {
            setPendingHandoffConvId(null);
            setAuthDialogOpen(true);
          }}
          onLogout={handleCustomerLogout}
        />

        {/* Four Integrated Workspaces */}
        {settings.showWorkspacesSummary && (
          <section
            id="workspaces"
            className="border-t border-slate-200 bg-slate-100/60"
          >
            <div className="mx-auto max-w-6xl px-6 py-14">
              <div className="mb-8 space-y-2">
                <h2 className="text-2xl font-bold text-slate-900">
                  چهار فضای کاری یکپارچه
                </h2>
                <p className="text-sm text-slate-600">
                  معماری ماژولار منولیت با جداسازی کامل مجوزهای سمت سرور
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {WORKSPACES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Card key={item.title} className="bg-white">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2.5">
                            <Icon className={`h-5 w-5 ${accentIcon} shrink-0`} />
                            <CardTitle className="text-base">{item.title}</CardTitle>
                          </div>
                          <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                            {item.phase}
                          </span>
                        </div>
                        <CardDescription className="pt-1">
                          {item.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Security Principles */}
        <section id="security" className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0" />
                  <CardTitle className="text-base">
                    مرزبندی دسترسی دپارتمانی (Backend-Enforced)
                  </CardTitle>
                </div>
                <CardDescription>
                  اپراتورها تنها به تیکت‌های دپارتمان‌های مجاز خود دسترسی دارند و
                  یادداشت‌های داخلی محرمانه هرگز برای مشتری ارسال نمی‌شوند.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <LockKeyhole className="h-5 w-5 text-blue-700 shrink-0" />
                  <CardTitle className="text-base">
                    حفاظت از کد ملی و پیوست‌های مشتری
                  </CardTitle>
                </div>
                <CardDescription>
                  کد ملی با اعتبارسنجی ریاضی بررسی و با AES-256-GCM و HMAC کلیددار
                  محافظت می‌شود و فایل‌های پیوست با امضای باینری کنترل می‌شوند.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6 py-6 text-xs text-slate-500">
          <span>
            سامانه پشتیبانی هوشمند و مخزن فایل سازمانی · معماری ماژولار منولیت
          </span>
          <div className="flex items-center gap-4">
            <Link href="/api/health" className="hover:text-slate-800">
              وضعیت سرویس
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/login" className="hover:text-slate-800">
              ورود کارکنان
            </Link>
          </div>
        </div>
      </footer>

      <DepartmentChatDialog
        key={selectedDepartment?.id ?? 'closed'}
        department={selectedDepartment}
        onClose={() => setSelectedDepartment(null)}
        onRequestCustomerAuthForHandoff={(convId) => {
          setPendingHandoffConvId(convId);
          setAuthDialogOpen(true);
        }}
        onOpenConvertedTicket={(ticketId) => {
          setSelectedDepartment(null);
          void refreshCustomerSession();
          setSelectedTicketId(ticketId);
          document
            .getElementById('customer-portal')
            ?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      <CustomerAuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        purpose={pendingHandoffConvId ? 'ticket_handoff' : 'customer_portal'}
        onVerified={handleCustomerVerified}
      />
    </div>
  );
}
