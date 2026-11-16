'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Headset,
  LockKeyhole,
  MessageCircle,
  Search,
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
import {
  DepartmentChatDialog,
  DepartmentConversationPanel,
} from '@/components/public/DepartmentChatDialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toPersianDigits } from '@/src/lib/jalali';
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

const ACCENT_GROUP_HOVER_ICON: Record<ThemeAccentPreset, string> = {
  blue: 'group-hover:text-blue-700',
  indigo: 'group-hover:text-indigo-700',
  emerald: 'group-hover:text-emerald-700',
  slate: 'group-hover:text-slate-800',
};

const ACCENT_ACTIVE_CARD: Record<ThemeAccentPreset, string> = {
  blue: 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600/20',
  indigo: 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600/20',
  emerald: 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600/20',
  slate: 'border-slate-700 bg-slate-100/70 ring-1 ring-slate-700/20',
};

const ACCENT_BORDER_HOVER: Record<ThemeAccentPreset, string> = {
  blue: 'hover:border-blue-500 focus-visible:ring-blue-600',
  indigo: 'hover:border-indigo-500 focus-visible:ring-indigo-600',
  emerald: 'hover:border-emerald-500 focus-visible:ring-emerald-600',
  slate: 'hover:border-slate-600 focus-visible:ring-slate-700',
};

const ACCENT_BADGE_BG: Record<ThemeAccentPreset, string> = {
  blue: 'group-hover:bg-blue-50',
  indigo: 'group-hover:bg-indigo-50',
  emerald: 'group-hover:bg-emerald-50',
  slate: 'group-hover:bg-slate-200',
};

const CUSTOMER_SUPPORT_STEPS = [
  {
    step: '۱',
    title: 'انتخاب دپارتمان تخصصی',
    description:
      'واحد مرتبط با سؤال یا درخواست خود را انتخاب کنید تا به راهنمای همان بخش متصل شوید.',
    icon: Building2,
  },
  {
    step: '۲',
    title: 'گفت‌وگوی فوری آنلاین',
    description:
      'پاسخ بسیاری از پرسش‌ها بلافاصله از طریق دستیار هوشمند ارائه می‌شود و در هر زمان می‌توانید با کارشناس ارتباط بگیرید.',
    icon: MessageCircle,
  },
  {
    step: '۳',
    title: 'دریافت کد پیگیری تیکت',
    description:
      'در صورت نیاز به بررسی کارشناسی یا ارسال فایل، گفت‌وگو با احراز هویت سریع به تیکت رسمی تبدیل و پیگیری می‌شود.',
    icon: Ticket,
  },
];

export function PublicShell({
  isAuthenticated,
  formattedDate,
  departments,
  settings = DEFAULT_PLATFORM_SETTINGS,
}: PublicShellProps) {
  const accentIcon = ACCENT_ICON_CLASSES[settings.themeAccent] || ACCENT_ICON_CLASSES.blue;
  const accentGroupHoverIcon =
    ACCENT_GROUP_HOVER_ICON[settings.themeAccent] || ACCENT_GROUP_HOVER_ICON.blue;
  const accentActiveCard =
    ACCENT_ACTIVE_CARD[settings.themeAccent] || ACCENT_ACTIVE_CARD.blue;
  const accentHover =
    ACCENT_BORDER_HOVER[settings.themeAccent] || ACCENT_BORDER_HOVER.blue;
  const accentBadgeBg = ACCENT_BADGE_BG[settings.themeAccent] || ACCENT_BADGE_BG.blue;

  const [deptQuery, setDeptQuery] = useState('');
  const [activeDepartmentId, setActiveDepartmentId] = useState<string>(
    departments[0]?.id ?? ''
  );
  const [modalDepartment, setModalDepartment] =
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

  const filteredDepartments = useMemo(() => {
    const q = deptQuery.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.nameFa.toLowerCase().includes(q) ||
        d.descriptionFa.toLowerCase().includes(q)
    );
  }, [departments, deptQuery]);

  const activeDepartment = useMemo(
    () =>
      departments.find((d) => d.id === activeDepartmentId) ??
      departments[0] ??
      null,
    [departments, activeDepartmentId]
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
          setModalDepartment(null);
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

  function handleSelectDepartment(dept: PublicDepartmentCard) {
    setActiveDepartmentId(dept.id);
    if (window.innerWidth < 1024) {
      document
        .getElementById('active-conversation')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Customer Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <Headset className={`h-5 w-5 ${accentIcon}`} />
            <span>{settings.brandNameFa}</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#support-desk"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              انتخاب دپارتمان و گفت‌وگو
            </a>
            <a
              href="#customer-portal"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              پیگیری تیکت‌های من
            </a>
            {settings.showWorkspacesSummary && (
              <a
                href="#support-guide"
                className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                راهنمای دریافت پشتیبانی
              </a>
            )}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              type="button"
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
              <Ticket className="h-4 w-4" />
              <span>{customer ? customer.fullName : 'پیگیری تیکت من'}</span>
            </Button>
            {isAuthenticated && (
              <Button asChild variant="outline" size="sm">
                <Link href="/workspace">پنل همکاران</Link>
              </Button>
            )}
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
        {/* Customer Hero */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="max-w-3xl space-y-5"
            >
              {settings.supportContactText.trim() && (
                <p className="text-xs font-medium text-slate-500">
                  {settings.supportContactText}
                </p>
              )}

              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight text-slate-900 [text-wrap:balance]">
                {settings.heroTitleFa}
              </h1>

              <p className="text-base md:text-lg leading-relaxed text-slate-600">
                {settings.heroDescriptionFa}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button asChild size="lg">
                  <a href="#support-desk">
                    <MessageCircle className="h-4 w-4" />
                    <span>انتخاب دپارتمان و شروع گفت‌وگو</span>
                  </a>
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
                  <Ticket className="h-4 w-4" />
                  <span>{customer ? 'مشاهده تیکت‌های من' : 'پیگیری تیکت‌های قبلی'}</span>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Interactive Department Selector + Live Conversation Hub */}
        <section id="support-desk" className="mx-auto max-w-6xl px-6 py-12">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <h2 className="text-2xl font-bold text-slate-900">
                انتخاب دپارتمان و گفت‌وگوی آنلاین
              </h2>
              <p className="text-sm text-slate-600">
                دپارتمان مرتبط را انتخاب کنید و بلافاصله پرسش خود را بپرسید یا درخواست
                ارتباط با کارشناس دهید.
              </p>
            </div>
            {departments.length > 0 && (
              <span className="text-xs text-slate-500 tabular-nums shrink-0">
                {toPersianDigits(departments.length)} دپارتمان آماده پاسخگویی
              </span>
            )}
          </div>

          {departments.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Building2 className={`h-4 w-4 ${accentIcon} shrink-0`} />
                    <span>در حال حاضر دپارتمان آنلاین فعالی منتشر نشده است</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">
                    لطفاً ساعاتی دیگر مراجعه کنید یا در صورت داشتن تیکت قبلی، از بخش
                    پیگیری تیکت‌ها وضعیت درخواست خود را بررسی نمایید.
                  </p>
                </div>
                {isAuthenticated && (
                  <Button asChild variant="secondary">
                    <Link href="/workspace/admin/departments">مدیریت دپارتمان‌ها</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Department Selector Column */}
              <div className="lg:col-span-5 space-y-3 min-w-0">
                {departments.length >= 4 && (
                  <div className="relative">
                    <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={deptQuery}
                      onChange={(e) => setDeptQuery(e.target.value)}
                      placeholder="جستجوی دپارتمان یا موضوع پشتیبانی..."
                      className="pr-9 bg-white"
                    />
                  </div>
                )}

                {filteredDepartments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 space-y-2">
                    <p>دپارتمانی با این عبارت یافت نشد.</p>
                    <button
                      type="button"
                      onClick={() => setDeptQuery('')}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      نمایش همه دپارتمان‌ها
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[580px] overflow-y-auto pl-1">
                    {filteredDepartments.map((dept) => {
                      const isActive = activeDepartment?.id === dept.id;
                      return (
                        <button
                          key={dept.id}
                          type="button"
                          onClick={() => handleSelectDepartment(dept)}
                          className={`group w-full text-right rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 cursor-pointer flex items-start justify-between gap-3 ${
                            isActive
                              ? accentActiveCard
                              : `border-slate-200 bg-white ${accentHover}`
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 ${accentBadgeBg} transition-colors`}
                            >
                              <DepartmentIcon
                                iconKey={dept.iconKey}
                                className={`h-5 w-5 ${accentIcon}`}
                              />
                            </div>
                            <div className="space-y-1 min-w-0">
                              <h3 className="text-sm font-semibold text-slate-900">
                                {dept.nameFa}
                              </h3>
                              <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                                {dept.descriptionFa ||
                                  'پاسخگویی و پشتیبانی تخصصی در این دپارتمان'}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-500">
                                <span>
                                  {dept.aiEnabled ? 'پاسخگویی هوشمند' : 'پشتیبانی مستقیم'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {dept.humanOperatorsAvailable
                                    ? 'کارشناس آماده پاسخگویی'
                                    : 'ثبت درخواست در صف'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <ArrowLeft
                            className={`h-4 w-4 shrink-0 mt-1 transition-colors ${
                              isActive
                                ? accentIcon
                                : `text-slate-400 ${accentGroupHoverIcon}`
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Active Conversation Workbench */}
              <div id="active-conversation" className="lg:col-span-7 min-w-0">
                {activeDepartment && (
                  <DepartmentConversationPanel
                    key={activeDepartment.id}
                    department={activeDepartment}
                    themeAccent={settings.themeAccent}
                    variant="inline"
                    onExpandModal={() => setModalDepartment(activeDepartment)}
                    onRequestCustomerAuthForHandoff={(convId) => {
                      setPendingHandoffConvId(convId);
                      setAuthDialogOpen(true);
                    }}
                    onOpenConvertedTicket={(ticketId) => {
                      void refreshCustomerSession();
                      setSelectedTicketId(ticketId);
                      document
                        .getElementById('customer-portal')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  />
                )}
              </div>
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

        {/* Visitor 3-Step Guide */}
        {settings.showWorkspacesSummary && (
          <section
            id="support-guide"
            className="border-t border-slate-200 bg-slate-100/60"
          >
            <div className="mx-auto max-w-6xl px-6 py-12 space-y-8">
              <div className="space-y-1.5">
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                  چگونه سریع‌تر به پاسخ برسید؟
                </h2>
                <p className="text-sm text-slate-600">
                  روند ساده دریافت راهنمایی آنلاین و پیگیری درخواست‌ها در پورتال پشتیبانی
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {CUSTOMER_SUPPORT_STEPS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Card key={item.step} className="bg-white">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <Icon className={`h-5 w-5 ${accentIcon} shrink-0`} />
                            <CardTitle className="text-base">{item.title}</CardTitle>
                          </div>
                          <span className="text-xs font-semibold text-slate-400 tabular-nums">
                            گام {item.step}
                          </span>
                        </div>
                        <CardDescription className="pt-1 leading-relaxed">
                          {item.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <LockKeyhole className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>
                    اطلاعات هویتی، تاریخچه گفت‌وگوها و فایل‌های پیوست شما به صورت
                    محرمانه و تنها در دپارتمان مربوطه نگهداری می‌شوند.
                  </span>
                </span>
                <span className="tabular-nums text-slate-500 shrink-0">
                  امروز: {formattedDate}
                </span>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6 py-6 text-xs text-slate-500">
          <span>
            {settings.brandNameFa}
            {settings.supportContactText.trim()
              ? ` · ${settings.supportContactText}`
              : ''}
          </span>
          <div className="flex items-center gap-4">
            <Link
              href={isAuthenticated ? '/workspace' : '/login'}
              className="hover:text-slate-800 transition-colors"
            >
              {isAuthenticated ? 'پنل همکاران' : 'ورود کارکنان'}
            </Link>
          </div>
        </div>
      </footer>

      <DepartmentChatDialog
        key={modalDepartment?.id ?? 'closed'}
        department={modalDepartment}
        themeAccent={settings.themeAccent}
        onClose={() => setModalDepartment(null)}
        onRequestCustomerAuthForHandoff={(convId) => {
          setPendingHandoffConvId(convId);
          setAuthDialogOpen(true);
        }}
        onOpenConvertedTicket={(ticketId) => {
          setModalDepartment(null);
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
