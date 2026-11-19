'use client';

import { useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  GitBranch,
  Loader2,
  Printer,
  RefreshCw,
  Sparkles,
  Ticket,
  Users,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatBytesFa,
  formatJalaliDate,
  formatJalaliDateTime,
  toPersianDigits,
} from '@/src/lib/jalali';
import type { ReportWindowDays } from '@/src/modules/admin/reports';

export interface OperationalReportsData {
  filters: {
    days: ReportWindowDays;
    departmentId: string | null;
    windowStartIso: string | null;
    windowEndIso: string;
  };
  departments: Array<{ id: string; nameFa: string }>;
  ticketSummary: {
    total: number;
    open: number;
    resolved: number;
    avgResolveHours: number | null;
    dailyVolume: Array<{
      dateIso: string;
      createdCount: number;
      openCount: number;
      resolvedCount: number;
    }>;
    byStatus: Array<{ status: string; count: number }>;
    byPriority: Array<{ priority: string; count: number }>;
    byDepartment: Array<{
      departmentId: string;
      nameFa: string;
      assignmentStrategy: string;
      total: number;
      openCount: number;
      resolvedCount: number;
      avgResolveHours: number | null;
    }>;
    recentTickets: Array<{
      id: string;
      referenceCode: string;
      subject: string;
      status: string;
      priority: string;
      departmentName: string;
      assignedOperatorName: string;
      createdAt: string;
      lastMessageAt: string;
    }>;
  };
  assignmentReport: {
    totalAssignments: number;
    byStrategy: Array<{ strategyUsed: string; count: number }>;
    recentAssignments: Array<{
      id: string;
      ticketId: string;
      referenceCode: string;
      toDepartmentName: string;
      toOperatorName: string;
      fromOperatorName: string | null;
      assignedByName: string;
      strategyUsed: string;
      reason: string | null;
      createdAt: string;
    }>;
  };
  operatorActivity: Array<{
    userId: string;
    name: string;
    username: string;
    status: string;
    isAvailable: boolean;
    departmentNames: string[];
    activeTickets: number;
    resolvedTickets: number;
    avgResolveHours: number | null;
    minResolveHours: number | null;
    maxResolveHours: number | null;
    publicReplies: number;
    internalNotes: number;
    filesUploaded: number;
    bytesUploaded: number;
    lastLoginAt: string | null;
  }>;
  aiSummary: {
    totalCalls: number;
    successCount: number;
    abstainedCount: number;
    escalatedCount: number;
    errorCount: number;
    promptTokens: number;
    completionTokens: number;
    byDepartment: Array<{
      departmentId: string | null;
      departmentName: string;
      total: number;
      successCount: number;
      abstainedCount: number;
      escalatedCount: number;
      errorCount: number;
      avgLatencyMs: number;
    }>;
  };
}

const STATUS_LABELS: Record<string, string> = {
  open: 'باز',
  waiting_for_operator: 'در انتظار اپراتور',
  assigned: 'تخصیص‌یافته',
  in_progress: 'در حال بررسی',
  waiting_for_customer: 'در انتظار مشتری',
  resolved: 'حل‌شده',
  closed: 'بسته',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'کم',
  normal: 'عادی',
  high: 'بالا',
  urgent: 'فوری',
};

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: 'نوبتی عادلانه (Round-Robin)',
  least_loaded: 'کمترین بار کاری (Least-Loaded)',
  manual_queue: 'صف دستی دپارتمان',
  manual_reassign: 'تخصیص/بازتخصیص دستی',
  department_transfer: 'انتقال بین دپارتمان‌ها',
};

function formatResolveDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) {
    return `${toPersianDigits(Math.max(1, Math.round(hours * 60)))} دقیقه`;
  }
  return `${toPersianDigits(hours.toFixed(1))} ساعت`;
}

export function OperationalReportsDashboard({
  initialData,
}: {
  initialData: OperationalReportsData;
}) {
  const [data, setData] = useState<OperationalReportsData>(initialData);
  const [days, setDays] = useState<ReportWindowDays>(initialData.filters.days);
  const [customDaysInput, setCustomDaysInput] = useState<string>(
    typeof initialData.filters.days === 'number'
      ? String(initialData.filters.days)
      : '30'
  );
  const [departmentId, setDepartmentId] = useState<string>(
    initialData.filters.departmentId || ''
  );
  const [loading, setLoading] = useState(false);

  async function reloadReports(nextDays = days, nextDeptId = departmentId) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('days', String(nextDays));
      if (nextDeptId) qs.set('departmentId', nextDeptId);
      const res = await fetch(`/api/admin/reports?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در دریافت گزارش‌ها.');
        return;
      }
      setData(json);
      setDays(nextDays);
      if (typeof nextDays === 'number') {
        setCustomDaysInput(String(nextDays));
      }
    } catch {
      toast.error('خطای شبکه در دریافت گزارش‌ها.');
    } finally {
      setLoading(false);
    }
  }

  function applyCustomDays(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(customDaysInput.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      toast.error('تعداد روز باید عدد صحیح بین ۱ تا ۳۶۵ باشد.');
      return;
    }
    void reloadReports(parsed, departmentId);
  }

  function exportUrl(kind: 'tickets' | 'assignments' | 'operators') {
    const qs = new URLSearchParams();
    qs.set('kind', kind);
    qs.set('days', String(days));
    if (departmentId) qs.set('departmentId', departmentId);
    return `/api/admin/reports/export?${qs.toString()}`;
  }

  function printSummaryUrl() {
    const qs = new URLSearchParams();
    qs.set('days', String(days));
    if (departmentId) qs.set('departmentId', departmentId);
    return `/workspace/admin/reports/print?${qs.toString()}`;
  }

  const presetValue =
    days === 'all' || [7, 14, 30, 60, 90].includes(Number(days))
      ? String(days)
      : 'custom';

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            گزارش‌های جامع عملیاتی و عملکرد
          </h1>
          <p className="text-sm text-slate-600">
            آمار حجم تیکت‌ها، زمان حل اپراتورها، توزیع و ارجاعات و خلاصه مصرف هوش مصنوعی
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="بازه زمانی گزارش"
            value={presetValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') return;
              const next: ReportWindowDays = v === 'all' ? 'all' : Number(v);
              void reloadReports(next, departmentId);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <option value="7">۷ روز گذشته</option>
            <option value="14">۱۴ روز گذشته</option>
            <option value="30">۳۰ روز گذشته</option>
            <option value="60">۶۰ روز گذشته</option>
            <option value="90">۹۰ روز گذشته</option>
            <option value="all">کل تاریخچه</option>
            {presetValue === 'custom' && (
              <option value="custom">
                بازه دلخواه ({toPersianDigits(days)} روز)
              </option>
            )}
          </select>

          <form onSubmit={applyCustomDays} className="flex items-center gap-1.5">
            <input
              aria-label="تعداد روز دلخواه"
              type="number"
              min={1}
              max={365}
              value={customDaysInput}
              onChange={(e) => setCustomDaysInput(e.target.value)}
              className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-center tabular-nums text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              title="تعداد روز (۱ تا ۳۶۵)"
            />
            <Button type="submit" variant="outline" size="sm" disabled={loading}>
              اعمال روز
            </Button>
          </form>

          <select
            aria-label="فیلتر دپارتمان"
            value={departmentId}
            onChange={(e) => {
              const nextDept = e.target.value;
              setDepartmentId(nextDept);
              void reloadReports(days, nextDept);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <option value="">همه دپارتمان‌ها</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameFa}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void reloadReports()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>بروزرسانی</span>
          </Button>

          <Button asChild size="sm" className="whitespace-nowrap shrink-0">
            <Link href={printSummaryUrl()}>
              <Printer className="h-4 w-4" />
              <span>گزارش چاپی PDF</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>کل تیکت‌ها و زمان حل</CardDescription>
            <CardTitle className="text-2xl tabular-nums flex items-center gap-2">
              <Ticket className="h-5 w-5 text-blue-700" />
              <span>{toPersianDigits(data.ticketSummary.total)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(data.ticketSummary.open)} باز ·{' '}
            {toPersianDigits(data.ticketSummary.resolved)} مختومه · میانگین حل:{' '}
            {formatResolveDuration(data.ticketSummary.avgResolveHours)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>توزیع و ارجاع تیکت</CardDescription>
            <CardTitle className="text-2xl tabular-nums flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-emerald-700" />
              <span>{toPersianDigits(data.assignmentReport.totalAssignments)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            رویداد تخصیص خودکار و دستی ثبت‌شده
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>اپراتورهای فعال سامانه</CardDescription>
            <CardTitle className="text-2xl tabular-nums flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-700" />
              <span>
                {toPersianDigits(
                  data.operatorActivity.filter((o) => o.status === 'active').length
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            از مجموع {toPersianDigits(data.operatorActivity.length)} حساب کاربری
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>فراخوانی‌های هوش مصنوعی</CardDescription>
            <CardTitle className="text-2xl tabular-nums flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-600" />
              <span>{toPersianDigits(data.aiSummary.totalCalls)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(data.aiSummary.successCount)} پاسخ موفق ·{' '}
            {toPersianDigits(data.aiSummary.abstainedCount)} امتناع امن
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tickets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tickets">گزارش تیکت‌ها</TabsTrigger>
          <TabsTrigger value="assignments">گزارش تخصیص و ارجاع</TabsTrigger>
          <TabsTrigger value="operators">فعالیت اپراتورها</TabsTrigger>
          <TabsTrigger value="ai">خلاصه مصرف هوش مصنوعی</TabsTrigger>
        </TabsList>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">توزیع بر اساس وضعیت تیکت</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.ticketSummary.byStatus.length === 0 ? (
                  <p className="text-slate-500">تیکتی در این بازه ثبت نشده است.</p>
                ) : (
                  data.ticketSummary.byStatus.map((row) => (
                    <div
                      key={row.status}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <span>{STATUS_LABELS[row.status] || row.status}</span>
                      <span className="font-semibold tabular-nums">
                        {toPersianDigits(row.count)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">توزیع بر اساس اولویت</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {data.ticketSummary.byPriority.length === 0 ? (
                  <p className="text-slate-500">تیکتی در این بازه ثبت نشده است.</p>
                ) : (
                  data.ticketSummary.byPriority.map((row) => (
                    <div
                      key={row.priority}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <span>{PRIORITY_LABELS[row.priority] || row.priority}</span>
                      <span className="font-semibold tabular-nums">
                        {toPersianDigits(row.count)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  روند حجم روزانه تیکت‌ها در بازه انتخاب‌شده
                </CardTitle>
                <CardDescription>
                  تعداد تیکت‌های ثبت‌شده و مختومه به تفکیک روز (زمان تهران)
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit whitespace-nowrap shrink-0">
                <Link href={printSummaryUrl()}>
                  <Printer className="h-4 w-4" />
                  <span>پیش‌نمایش چاپی PDF</span>
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.ticketSummary.dailyVolume.filter(
                (r) => r.createdCount > 0 || r.resolvedCount > 0
              ).length === 0 ? (
                <p className="text-sm text-slate-500">
                  در این بازه زمانی تیکتی ثبت یا مختومه نشده است.
                </p>
              ) : (
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">تاریخ (شمسی)</th>
                      <th className="py-2.5 px-3 font-medium">تیکت‌های ثبت‌شده</th>
                      <th className="py-2.5 px-3 font-medium">حل / مختومه‌شده</th>
                      <th className="py-2.5 px-3 font-medium">همچنان باز</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.ticketSummary.dailyVolume
                      .filter((r) => r.createdCount > 0 || r.resolvedCount > 0)
                      .slice(-30)
                      .map((row) => (
                        <tr key={row.dateIso}>
                          <td className="py-2 px-3 text-xs tabular-nums">
                            {formatJalaliDate(`${row.dateIso}T12:00:00Z`)}
                          </td>
                          <td className="py-2 px-3 tabular-nums font-medium">
                            {toPersianDigits(row.createdCount)}
                          </td>
                          <td className="py-2 px-3 tabular-nums text-emerald-700">
                            {toPersianDigits(row.resolvedCount)}
                          </td>
                          <td className="py-2 px-3 tabular-nums text-amber-700">
                            {toPersianDigits(row.openCount)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">آمار تیکت به تفکیک دپارتمان</CardTitle>
                <CardDescription>
                  تعداد تیکت‌های باز، حل‌شده و میانگین زمان حل تیکت (ساعت)
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit whitespace-nowrap shrink-0">
                <a href={exportUrl('tickets')}>
                  <Download className="h-4 w-4" />
                  <span>خروجی CSV تیکت‌ها</span>
                </a>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-3 font-medium">دپارتمان</th>
                    <th className="py-2.5 px-3 font-medium">استراتژی توزیع</th>
                    <th className="py-2.5 px-3 font-medium">کل</th>
                    <th className="py-2.5 px-3 font-medium">باز</th>
                    <th className="py-2.5 px-3 font-medium">مختومه</th>
                    <th className="py-2.5 px-3 font-medium">میانگین زمان حل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.ticketSummary.byDepartment.map((d) => (
                    <tr key={d.departmentId}>
                      <td className="py-2.5 px-3 font-medium">{d.nameFa}</td>
                      <td className="py-2.5 px-3 text-xs text-slate-600">
                        {STRATEGY_LABELS[d.assignmentStrategy] || d.assignmentStrategy}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {toPersianDigits(d.total)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-amber-700">
                        {toPersianDigits(d.openCount)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-emerald-700">
                        {toPersianDigits(d.resolvedCount)}
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums">
                        {formatResolveDuration(d.avgResolveHours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">تیکت‌های اخیر</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.ticketSummary.recentTickets.length === 0 ? (
                <p className="text-sm text-slate-500">تیکتی در این بازه ثبت نشده است.</p>
              ) : (
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">کد پیگیری</th>
                      <th className="py-2.5 px-3 font-medium">موضوع</th>
                      <th className="py-2.5 px-3 font-medium">دپارتمان</th>
                      <th className="py-2.5 px-3 font-medium">اپراتور</th>
                      <th className="py-2.5 px-3 font-medium">وضعیت</th>
                      <th className="py-2.5 px-3 font-medium">زمان ثبت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.ticketSummary.recentTickets.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)]">
                          <Link
                            href={`/workspace/desk/tickets/${t.id}`}
                            className="text-blue-700 hover:underline"
                          >
                            {t.referenceCode}
                          </Link>
                        </td>
                        <td className="py-2.5 px-3 font-medium">{t.subject}</td>
                        <td className="py-2.5 px-3 text-xs">{t.departmentName}</td>
                        <td className="py-2.5 px-3 text-xs">{t.assignedOperatorName}</td>
                        <td className="py-2.5 px-3 text-xs">
                          {STATUS_LABELS[t.status] || t.status}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums text-slate-500">
                          {formatJalaliDateTime(t.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">تفکیک بر اساس روش توزیع و ارجاع</CardTitle>
                <CardDescription>
                  بررسی عملکرد موتور توزیع خودکار در مقایسه با ارجاعات دستی
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit whitespace-nowrap shrink-0">
                <a href={exportUrl('assignments')}>
                  <Download className="h-4 w-4" />
                  <span>خروجی CSV ارجاعات</span>
                </a>
              </Button>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {data.assignmentReport.byStrategy.length === 0 ? (
                <p className="text-slate-500">رویداد تخصیصی ثبت نشده است.</p>
              ) : (
                data.assignmentReport.byStrategy.map((s) => (
                  <div
                    key={s.strategyUsed}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between"
                  >
                    <span>{STRATEGY_LABELS[s.strategyUsed] || s.strategyUsed}</span>
                    <span className="text-sm font-bold tabular-nums text-blue-800">
                      {toPersianDigits(s.count)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">تاریخچه اخیر تخصیص و انتقال تیکت‌ها</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.assignmentReport.recentAssignments.length === 0 ? (
                <p className="text-sm text-slate-500">موردی ثبت نشده است.</p>
              ) : (
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">تیکت</th>
                      <th className="py-2.5 px-3 font-medium">دپارتمان مقصد</th>
                      <th className="py-2.5 px-3 font-medium">اپراتور مقصد</th>
                      <th className="py-2.5 px-3 font-medium">روش توزیع</th>
                      <th className="py-2.5 px-3 font-medium">توسط</th>
                      <th className="py-2.5 px-3 font-medium">زمان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.assignmentReport.recentAssignments.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)]">
                          <Link
                            href={`/workspace/desk/tickets/${a.ticketId}`}
                            className="text-blue-700 hover:underline"
                          >
                            {a.referenceCode}
                          </Link>
                        </td>
                        <td className="py-2.5 px-3 text-xs">{a.toDepartmentName}</td>
                        <td className="py-2.5 px-3 text-xs font-medium">
                          {a.toOperatorName}
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          {STRATEGY_LABELS[a.strategyUsed] || a.strategyUsed}
                        </td>
                        <td className="py-2.5 px-3 text-xs">{a.assignedByName}</td>
                        <td className="py-2.5 px-3 text-xs tabular-nums text-slate-500">
                          {formatJalaliDateTime(a.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Operators Activity Tab */}
        <TabsContent value="operators">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-700" />
                  <span>گزارش فعالیت و بار کاری اپراتورها</span>
                </CardTitle>
                <CardDescription>
                  تعداد تیکت‌های باز، مختومه، پاسخ‌های ارسالی، یادداشت‌های داخلی و مصرف
                  فایل
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit whitespace-nowrap shrink-0">
                <a href={exportUrl('operators')}>
                  <Download className="h-4 w-4" />
                  <span>خروجی CSV اپراتورها</span>
                </a>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-3 font-medium">اپراتور</th>
                    <th className="py-2.5 px-3 font-medium">دپارتمان‌ها</th>
                    <th className="py-2.5 px-3 font-medium">حضور</th>
                    <th className="py-2.5 px-3 font-medium">تیکت باز</th>
                    <th className="py-2.5 px-3 font-medium">تیکت مختومه</th>
                    <th className="py-2.5 px-3 font-medium">میانگین زمان حل</th>
                    <th className="py-2.5 px-3 font-medium">بازه حل (کمینه / بیشینه)</th>
                    <th className="py-2.5 px-3 font-medium">پاسخ / یادداشت</th>
                    <th className="py-2.5 px-3 font-medium">فایل اشتراکی</th>
                    <th className="py-2.5 px-3 font-medium">آخرین ورود</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.operatorActivity.map((op) => (
                    <tr key={op.userId}>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{op.name}</div>
                        <div className="text-[11px] text-slate-500 font-[family-name:var(--font-mono)]">
                          @{op.username}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 max-w-44">
                        {op.departmentNames.join('، ') || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {op.status !== 'active' ? (
                          <span className="text-red-700">غیرفعال</span>
                        ) : op.isAvailable ? (
                          <span className="text-emerald-700">آماده</span>
                        ) : (
                          <span className="text-amber-700">غیرفعال موقت</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {toPersianDigits(op.activeTickets)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-emerald-700">
                        {toPersianDigits(op.resolvedTickets)}
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums font-medium text-blue-800">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          <span>{formatResolveDuration(op.avgResolveHours)}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums text-slate-600">
                        {op.minResolveHours !== null && op.maxResolveHours !== null
                          ? `${formatResolveDuration(op.minResolveHours)} / ${formatResolveDuration(op.maxResolveHours)}`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums">
                        {toPersianDigits(op.publicReplies)} /{' '}
                        {toPersianDigits(op.internalNotes)}
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums">
                        {toPersianDigits(op.filesUploaded)} (
                        {formatBytesFa(op.bytesUploaded)})
                      </td>
                      <td className="py-2.5 px-3 text-xs tabular-nums text-slate-500">
                        {op.lastLoginAt ? formatJalaliDateTime(op.lastLoginAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Summary Tab */}
        <TabsContent value="ai">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-700" />
                  <span>خلاصه عملکرد دستیار هوشمند به تفکیک دپارتمان</span>
                </CardTitle>
                <CardDescription className="tabular-nums">
                  مجموع توکن مصرفی در بازه: {toPersianDigits(data.aiSummary.promptTokens)}{' '}
                  ورودی / {toPersianDigits(data.aiSummary.completionTokens)} خروجی
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="w-fit whitespace-nowrap shrink-0">
                <Link href="/workspace/admin/ai-reports">گزارش تفصیلی منابع AI</Link>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.aiSummary.byDepartment.length === 0 ? (
                <p className="text-sm text-slate-500">
                  در این بازه فراخوانی هوش مصنوعی ثبت نشده است.
                </p>
              ) : (
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">دپارتمان</th>
                      <th className="py-2.5 px-3 font-medium">کل</th>
                      <th className="py-2.5 px-3 font-medium">موفق</th>
                      <th className="py-2.5 px-3 font-medium">امتناع امن</th>
                      <th className="py-2.5 px-3 font-medium">ارجاع</th>
                      <th className="py-2.5 px-3 font-medium">خطا</th>
                      <th className="py-2.5 px-3 font-medium">میانگین تأخیر</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.aiSummary.byDepartment.map((row) => (
                      <tr key={row.departmentId || 'general'}>
                        <td className="py-2.5 px-3 font-medium">{row.departmentName}</td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {toPersianDigits(row.total)}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-emerald-700">
                          {toPersianDigits(row.successCount)}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-amber-700">
                          {toPersianDigits(row.abstainedCount)}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-blue-700">
                          {toPersianDigits(row.escalatedCount)}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-red-700">
                          {toPersianDigits(row.errorCount)}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {toPersianDigits(row.avgLatencyMs)} میلی‌ثانیه
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
