'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Clock,
  Loader2,
  Printer,
  RefreshCw,
  Ticket,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { OperationalReportsData } from '@/components/admin/OperationalReportsDashboard';
import {
  formatJalaliDate,
  formatJalaliDateTime,
  toPersianDigits,
} from '@/src/lib/jalali';
import type { ReportWindowDays } from '@/src/modules/admin/reports';

function formatDurationHoursFa(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) {
    return `${toPersianDigits(Math.max(1, Math.round(hours * 60)))} دقیقه`;
  }
  return `${toPersianDigits(hours.toFixed(1))} ساعت`;
}

export function PrintableTicketReport({
  initialData,
  organizationNameFa,
  brandNameFa,
  generatedByName,
  generatedAtIso,
}: {
  initialData: OperationalReportsData;
  organizationNameFa: string;
  brandNameFa: string;
  generatedByName: string;
  generatedAtIso: string;
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
  const [showEmptyDays, setShowEmptyDays] = useState<boolean>(
    typeof initialData.filters.days === 'number' &&
      initialData.filters.days <= 31
  );
  const [loading, setLoading] = useState(false);

  async function reloadReport(nextDays: ReportWindowDays, nextDeptId: string) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('days', String(nextDays));
      if (nextDeptId) qs.set('departmentId', nextDeptId);
      const res = await fetch(`/api/admin/reports?${qs.toString()}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بروزرسانی گزارش چاپی.');
        return;
      }
      setData(json);
      setDays(nextDays);
      if (typeof nextDays === 'number') {
        setCustomDaysInput(String(nextDays));
        setShowEmptyDays(nextDays <= 31);
      } else {
        setShowEmptyDays(false);
      }
    } catch {
      toast.error('خطای شبکه در دریافت اطلاعات گزارش.');
    } finally {
      setLoading(false);
    }
  }

  function applyCustomDays(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(customDaysInput.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      toast.error('لطفاً عدد صحیح بین ۱ تا ۳۶۵ روز وارد کنید.');
      return;
    }
    void reloadReport(parsed, departmentId);
  }

  const selectedDeptName = useMemo(() => {
    if (!departmentId) return 'همه دپارتمان‌ها';
    return (
      data.departments.find((d) => d.id === departmentId)?.nameFa ||
      'دپارتمان انتخاب‌شده'
    );
  }, [data.departments, departmentId]);

  const resolutionRatePct = useMemo(() => {
    if (data.ticketSummary.total === 0) return 0;
    return Math.round(
      (data.ticketSummary.resolved / data.ticketSummary.total) * 100
    );
  }, [data.ticketSummary.resolved, data.ticketSummary.total]);

  const visibleDailyRows = useMemo(() => {
    if (showEmptyDays) return data.ticketSummary.dailyVolume;
    return data.ticketSummary.dailyVolume.filter(
      (d) => d.createdCount > 0 || d.resolvedCount > 0
    );
  }, [data.ticketSummary.dailyVolume, showEmptyDays]);

  const maxDailyCount = useMemo(() => {
    let max = 1;
    for (const row of visibleDailyRows) {
      if (row.createdCount > max) max = row.createdCount;
      if (row.resolvedCount > max) max = row.resolvedCount;
    }
    return max;
  }, [visibleDailyRows]);

  const sortedOperators = useMemo(() => {
    return [...data.operatorActivity].sort((a, b) => {
      if (b.resolvedTickets !== a.resolvedTickets) {
        return b.resolvedTickets - a.resolvedTickets;
      }
      if (b.activeTickets !== a.activeTickets) {
        return b.activeTickets - a.activeTickets;
      }
      return a.name.localeCompare(b.name, 'fa');
    });
  }, [data.operatorActivity]);

  const backHref = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('days', String(days));
    if (departmentId) qs.set('departmentId', departmentId);
    return `/workspace/admin/reports?${qs.toString()}`;
  }, [days, departmentId]);

  const windowLabel =
    days === 'all'
      ? 'کل تاریخچه ثبت‌شده'
      : `${toPersianDigits(days)} روز گذشته`;

  const operatorsWithResolved = useMemo(
    () =>
      data.operatorActivity.filter((op) => op.resolvedTickets > 0).length,
    [data.operatorActivity]
  );

  return (
    <div className="space-y-6 print:space-y-4">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      {/* Screen-Only Toolbar */}
      <div className="print:hidden rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>
                <ArrowRight className="h-4 w-4" />
                <span>بازگشت به گزارش‌ها</span>
              </Link>
            </Button>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                پیش‌نمایش چاپی و خروجی PDF گزارش عملکرد
              </h1>
              <p className="text-xs text-slate-500">
                بازه زمانی دلخواه را تنظیم کرده و نسخه چاپی یا فایل PDF دریافت کنید
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void reloadReport(days, departmentId)}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span>بروزرسانی</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => window.print()}
              disabled={loading}
            >
              <Printer className="h-4 w-4" />
              <span>چاپ / ذخیره PDF</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100">
            {[7, 14, 30, 90].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void reloadReport(preset, departmentId)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                  days === preset
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {toPersianDigits(preset)} روز
              </button>
            ))}
            <button
              type="button"
              onClick={() => void reloadReport('all', departmentId)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                days === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              کل تاریخچه
            </button>
          </div>

          <form onSubmit={applyCustomDays} className="flex items-center gap-1.5">
            <label
              htmlFor="print-custom-days"
              className="text-xs text-slate-600 whitespace-nowrap"
            >
              تعداد روز دلخواه:
            </label>
            <input
              id="print-custom-days"
              type="number"
              min={1}
              max={365}
              value={customDaysInput}
              onChange={(e) => setCustomDaysInput(e.target.value)}
              className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <Button type="submit" variant="outline" size="sm" disabled={loading}>
              اعمال
            </Button>
          </form>

          <select
            aria-label="فیلتر دپارتمان برای چاپ"
            value={departmentId}
            onChange={(e) => {
              const nextDept = e.target.value;
              setDepartmentId(nextDept);
              void reloadReport(days, nextDept);
            }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">همه دپارتمان‌ها</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameFa}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showEmptyDays}
              onChange={(e) => setShowEmptyDays(e.target.checked)}
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span>نمایش روزهای بدون تیکت در جدول روزانه</span>
          </label>
        </div>
      </div>

      {/* Printable A4 Sheet */}
      <article className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 print:border-0 print:rounded-none print:p-0 space-y-6">
        {/* Official Report Header */}
        <header className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              {organizationNameFa || brandNameFa}
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              گزارش خلاصه حجم تیکت‌ها و زمان حل اپراتورها
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 tabular-nums">
              <span>بازه گزارش: {windowLabel}</span>
              {data.filters.windowStartIso && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    از {formatJalaliDate(data.filters.windowStartIso)} تا{' '}
                    {formatJalaliDate(data.filters.windowEndIso)}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>محدوده دپارتمان: {selectedDeptName}</span>
            </div>
          </div>

          <div className="text-xs text-slate-600 space-y-1 sm:text-left tabular-nums shrink-0">
            <div>تاریخ تهیه: {formatJalaliDateTime(generatedAtIso)}</div>
            <div>تهیه‌کننده: {generatedByName}</div>
          </div>
        </header>

        {/* Executive KPI Summary */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 break-inside-avoid">
          <div className="rounded-lg border border-slate-200 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>کل حجم تیکت‌ها</span>
              <Ticket className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="text-xl font-bold text-slate-900 tabular-nums">
              {toPersianDigits(data.ticketSummary.total)}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              نرخ اختتام: {toPersianDigits(resolutionRatePct)}٪
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>وضعیت تیکت‌های باز</span>
              <Building2 className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="text-xl font-bold text-amber-700 tabular-nums">
              {toPersianDigits(data.ticketSummary.open)}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              مختومه در بازه: {toPersianDigits(data.ticketSummary.resolved)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>میانگین زمان حل کل</span>
              <Clock className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="text-xl font-bold text-blue-800 tabular-nums">
              {formatDurationHoursFa(data.ticketSummary.avgResolveHours)}
            </div>
            <div className="text-[11px] text-slate-500">
              از زمان ثبت تا حل/بستن تیکت
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3.5 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>اپراتورهای فعال در حل</span>
              <Users className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="text-xl font-bold text-emerald-700 tabular-nums">
              {toPersianDigits(operatorsWithResolved)}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              از مجموع {toPersianDigits(data.operatorActivity.length)} اپراتور
            </div>
          </div>
        </section>

        {/* Section 1: Daily Ticket Volume */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-slate-900">
              ۱. روند روزانه حجم تیکت‌ها
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">
              {toPersianDigits(visibleDailyRows.length)} روز نمایش داده‌شده
            </span>
          </div>

          {visibleDailyRows.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">
              در بازه زمانی انتخاب‌شده تیکتی ثبت یا مختومه نشده است.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-slate-600">
                    <th className="py-2 px-3 font-semibold">تاریخ (شمسی)</th>
                    <th className="py-2 px-3 font-semibold text-left">تیکت ثبت‌شده</th>
                    <th className="py-2 px-3 font-semibold text-left">حل / مختومه</th>
                    <th className="py-2 px-3 font-semibold text-left">باقی‌مانده باز</th>
                    <th className="py-2 px-3 font-semibold w-40">نمودار حجم ثبت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleDailyRows.map((row) => {
                    const widthPct = Math.round(
                      (row.createdCount / maxDailyCount) * 100
                    );
                    return (
                      <tr key={row.dateIso}>
                        <td className="py-1.5 px-3 tabular-nums text-slate-800 whitespace-nowrap">
                          {formatJalaliDate(`${row.dateIso}T12:00:00Z`)}
                        </td>
                        <td className="py-1.5 px-3 text-left tabular-nums font-medium text-slate-900">
                          {toPersianDigits(row.createdCount)}
                        </td>
                        <td className="py-1.5 px-3 text-left tabular-nums text-emerald-700">
                          {toPersianDigits(row.resolvedCount)}
                        </td>
                        <td className="py-1.5 px-3 text-left tabular-nums text-amber-700">
                          {toPersianDigits(row.openCount)}
                        </td>
                        <td className="py-1.5 px-3">
                          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-700"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 2: Department Breakdown */}
        <section className="space-y-3 break-inside-avoid">
          <div className="border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-slate-900">
              ۲. حجم تیکت و میانگین زمان حل به تفکیک دپارتمان
            </h3>
          </div>

          {data.ticketSummary.byDepartment.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              دپارتمانی برای نمایش وجود ندارد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-slate-600">
                    <th className="py-2 px-3 font-semibold">دپارتمان</th>
                    <th className="py-2 px-3 font-semibold text-left">کل تیکت‌ها</th>
                    <th className="py-2 px-3 font-semibold text-left">باز</th>
                    <th className="py-2 px-3 font-semibold text-left">مختومه</th>
                    <th className="py-2 px-3 font-semibold text-left">
                      میانگین زمان حل
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.ticketSummary.byDepartment.map((dept) => (
                    <tr key={dept.departmentId}>
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {dept.nameFa}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums">
                        {toPersianDigits(dept.total)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums text-amber-700">
                        {toPersianDigits(dept.openCount)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums text-emerald-700">
                        {toPersianDigits(dept.resolvedCount)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums font-medium text-slate-800">
                        {formatDurationHoursFa(dept.avgResolveHours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section 3: Operator Resolution Times */}
        <section className="space-y-3">
          <div className="border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-slate-900">
              ۳. زمان حل تیکت و عملکرد اپراتورها
            </h3>
          </div>

          {sortedOperators.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              اپراتوری در محدوده انتخاب‌شده یافت نشد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-50 text-slate-600">
                    <th className="py-2 px-3 font-semibold">اپراتور</th>
                    <th className="py-2 px-3 font-semibold">دپارتمان‌ها</th>
                    <th className="py-2 px-2.5 font-semibold text-left">باز</th>
                    <th className="py-2 px-2.5 font-semibold text-left">مختومه</th>
                    <th className="py-2 px-2.5 font-semibold text-left">پاسخ‌ها</th>
                    <th className="py-2 px-3 font-semibold text-left">
                      میانگین زمان حل
                    </th>
                    <th className="py-2 px-3 font-semibold text-left">سریع‌ترین</th>
                    <th className="py-2 px-3 font-semibold text-left">طولانی‌ترین</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedOperators.map((op) => (
                    <tr key={op.userId}>
                      <td className="py-2 px-3">
                        <div className="font-medium text-slate-900">{op.name}</div>
                        <div className="text-[10px] text-slate-500 font-[family-name:var(--font-mono)]">
                          @{op.username}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-600 max-w-40">
                        {op.departmentNames.join('، ') || '—'}
                      </td>
                      <td className="py-2 px-2.5 text-left tabular-nums text-amber-700">
                        {toPersianDigits(op.activeTickets)}
                      </td>
                      <td className="py-2 px-2.5 text-left tabular-nums font-semibold text-emerald-700">
                        {toPersianDigits(op.resolvedTickets)}
                      </td>
                      <td className="py-2 px-2.5 text-left tabular-nums text-slate-700">
                        {toPersianDigits(op.publicReplies)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums font-semibold text-blue-800">
                        {formatDurationHoursFa(op.avgResolveHours)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums text-slate-600">
                        {formatDurationHoursFa(op.minResolveHours)}
                      </td>
                      <td className="py-2 px-3 text-left tabular-nums text-slate-600">
                        {formatDurationHoursFa(op.maxResolveHours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Report Footer */}
        <footer className="border-t border-slate-200 pt-3 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
          <span>
            {brandNameFa} · گزارش خلاصه تیکت‌ها و عملکرد اپراتورها ({windowLabel})
          </span>
          <span>تولید شده از داده‌های رسمی پایگاه داده</span>
        </footer>
      </article>
    </div>
  );
}
