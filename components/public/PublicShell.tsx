'use client';

import { motion } from 'motion/react';
import {
  Building2,
  FolderLock,
  Headset,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PublicShellProps {
  isAuthenticated: boolean;
  formattedDate: string;
  version: string;
}

const WORKSPACES = [
  {
    title: 'پورتال عمومی پشتیبانی',
    phase: 'فاز ۱: پوسته آماده · فاز ۲ و ۴: تکمیل',
    description:
      'انتخاب پویا دپارتمان‌ها از پایگاه داده، احراز هویت امن مراجعین و گفت‌وگوی یکپارچه با دستیار هوشمند و اپراتور.',
    icon: Headset,
  },
  {
    title: 'میز کار اپراتورها',
    phase: 'فاز ۲ و ۴',
    description:
      'مدیریت صف تیکت‌های دپارتمان، توزیع عادلانه خودکار، یادداشت‌های داخلی محرمانه و ارجاع بین دپارتمان‌ها.',
    icon: Building2,
  },
  {
    title: 'مخزن فایل اشتراکی',
    phase: 'فاز ۵',
    description:
      'کتابخانه ساختاریافته اسناد سازمانی با کنترل دسترسی دپارتمانی، سهمیه حجمی و ممیزی دانلود و بارگذاری.',
    icon: FolderLock,
  },
  {
    title: 'پنل مدیریت ارشد',
    phase: 'فاز ۱: هسته RBAC · فاز ۲ تا ۶: تکمیل',
    description:
      'پیکربندی متمرکز نقش‌ها، مجوزهای سطح کنش، مخزن دانش سازمانی، ارائه‌دهنده هوش مصنوعی و گزارش‌های ممیزی.',
    icon: SlidersHorizontal,
  },
];

export function PublicShell({
  isAuthenticated,
  formattedDate,
  version,
}: PublicShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            پشتیبانی سازمانی
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#departments"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              دپارتمان‌ها
            </a>
            <a
              href="#workspaces"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              فضاهای کاری
            </a>
            <a
              href="#security"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              اصول امنیتی
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Button asChild size="sm">
              <Link href={isAuthenticated ? '/workspace' : '/login'}>
                {isAuthenticated ? 'ورود به میز کار' : 'ورود کارکنان'}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="max-w-3xl space-y-6"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span>فاز اول: هسته معماری و استقرار</span>
                <span aria-hidden="true">·</span>
                <span className="font-[family-name:var(--font-mono)] tabular-nums">
                  v{version}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formattedDate}</span>
              </div>

              <h1 className="text-3xl md:text-5xl font-bold leading-tight text-slate-900 [text-wrap:balance]">
                سامانه یکپارچه پشتیبانی هوشمند و مخزن فایل سازمانی
              </h1>

              <p className="text-base md:text-lg leading-relaxed text-slate-600">
                زیرساخت مستقل، ماژولار و خودمیزبان برای پاسخگویی دقیق به مراجعین بر
                پایه مخزن دانش تاییدشده سازمان، مدیریت تیکت‌های دپارتمانی و تبادل امن
                فایل‌های داخلی.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button asChild size="lg">
                  <Link href={isAuthenticated ? '/workspace' : '/login'}>
                    {isAuthenticated ? 'ورود به پنل مدیریت و اپراتور' : 'ورود مدیر یا اپراتور'}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#departments">وضعیت دپارتمان‌های پشتیبانی</a>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Dynamic Departments Placeholder (Phase 1 Honest State) */}
        <section id="departments" className="mx-auto max-w-6xl px-6 py-14">
          <div className="mb-8 flex flex-col gap-2">
            <h2 className="text-2xl font-bold text-slate-900">
              دپارتمان‌های پشتیبانی
            </h2>
            <p className="text-sm text-slate-600">
              فهرست دپارتمان‌های فعال به صورت پویا از پایگاه داده PostgreSQL خوانده
              می‌شود.
            </p>
          </div>

          <Card className="bg-white">
            <CardContent className="p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Building2 className="h-4 w-4 text-blue-700 shrink-0" />
                  <span>آماده‌سازی هسته دپارتمان‌ها در فاز ۲</span>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  در فاز اول تنها زیرساخت پایه (پایگاه داده، مهاجرت‌های Drizzle،
                  احراز هویت، کنترل دسترسی RBAC، ذخیره‌سازی پایدار و استقرار Docker)
                  پیاده‌سازی شده است. بلافاصله پس از اجرای فاز ۲ و ایجاد دپارتمان
                  توسط مدیر ارشد، کارت‌های دپارتمان در این بخش ظاهر می‌شوند.
                </p>
              </div>
              <Button asChild variant="secondary">
                <Link href={isAuthenticated ? '/workspace' : '/login'}>
                  بررسی وضعیت هسته سامانه
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Four Integrated Workspaces */}
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
                          <Icon className="h-5 w-5 text-blue-700 shrink-0" />
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

        {/* Security Principles */}
        <section id="security" className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0" />
                  <CardTitle className="text-base">
                    کنترل دسترسی سخت‌گیرانه (Deny-by-Default)
                  </CardTitle>
                </div>
                <CardDescription>
                  تمامی مسیرهای مدیریتی و APIها بر پایه مجوزهای سطح کنش در PostgreSQL
                  ارزیابی می‌شوند و هیچ منطق امنیتی به رابط کاربری متکی نیست.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <LockKeyhole className="h-5 w-5 text-blue-700 shrink-0" />
                  <CardTitle className="text-base">
                    بوت‌استرپ امن مدیر ارشد و نگهداری پایدار
                  </CardTitle>
                </div>
                <CardDescription>
                  حساب اولیه مدیر ارشد تنها یک‌بار با هش ایمن ایجاد می‌شود، در استقرارهای
                  مجدد بازنویسی نمی‌گردد و تغییر رمز عبور در نخستین ورود الزامی است.
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
    </div>
  );
}
