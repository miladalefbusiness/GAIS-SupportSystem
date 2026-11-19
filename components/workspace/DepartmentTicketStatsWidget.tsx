'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { DepartmentIcon } from '@/components/departments/DepartmentIcon';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toPersianDigits } from '@/src/lib/jalali';
import type { DepartmentTicketQueueSummaryResult } from '@/src/modules/tickets/service';

type QueueFilter = 'all' | 'open' | 'awaiting' | 'member';

export function DepartmentTicketStatsWidget({
  initialSummary,
  canAdminDepartments,
  databaseOk,
}: {
  initialSummary: DepartmentTicketQueueSummaryResult;
  canAdminDepartments: boolean;
  databaseOk: boolean;
}) {
  const [summary, setSummary] =
    useState<DepartmentTicketQueueSummaryResult>(initialSummary);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    !databaseOk ? 'اتصال به پایگاه داده برای دریافت آمار زنده برقرار نیست.' : null
  );

  const memberCount = useMemo(
    () => summary.departments.filter((d) => d.isMember).length,
    [summary.departments]
  );

  const showMemberFilter =
    summary.scope === 'all_departments' &&
    memberCount > 0 &&
    memberCount < summary.departments.length;

  const openDeptCount = useMemo(
    () => summary.departments.filter((d) => d.openCount > 0).length,
    [summary.departments]
  );

  const awaitingDeptCount = useMemo(
    () => summary.departments.filter((d) => d.awaitingReplyCount > 0).length,
    [summary.departments]
  );

  const filteredDepartments = useMemo(() => {
    switch (filter) {
      case 'open':
        return summary.departments.filter((d) => d.openCount > 0);
      case 'awaiting':
        return summary.departments.filter((d) => d.awaitingReplyCount > 0);
      case 'member':
        return summary.departments.filter((d) => d.isMember);
      case 'all':
      default:
        return summary.departments;
    }
  }, [filter, summary.departments]);

  const filteredTotals = useMemo(
    () =>
      filteredDepartments.reduce(
        (acc, item) => {
          acc.openCount += item.openCount;
          acc.awaitingReplyCount += item.awaitingReplyCount;
          acc.waitingForCustomerCount += item.waitingForCustomerCount;
          return acc;
        },
        { openCount: 0, awaitingReplyCount: 0, waitingForCustomerCount: 0 }
      ),
    [filteredDepartments]
  );

  async function handleRefresh() {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/workspace/tickets/department-summary', {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          (body && typeof body.error === 'string' && body.error) ||
          'بروزرسانی آمار تیکت‌ها با خطا مواجه شد.';
        setErrorMessage(msg);
        toast.error(msg);
        return;
      }
      const next = (await res.json()) as DepartmentTicketQueueSummaryResult;
      setSummary(next);
    } catch {
      const msg = 'ارتباط با سرور برای دریافت آمار تیکت‌ها برقرار نشد.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-slate-100 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              تیکت‌های باز و در انتظار پاسخ به تفکیک دپارتمان‌های شما
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
              <span>
                {summary.scope === 'all_departments'
                  ? 'نمای کل دپارتمان‌های مجاز سازمان'
                  : 'بر اساس دپارتمان‌های عضویت شما'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                مجموع تیکت‌های باز:{' '}
                <strong className="font-semibold text-slate-800">
                  {toPersianDigits(summary.totals.openCount)}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                در انتظار پاسخ اپراتور:{' '}
                <strong
                  className={`font-semibold ${
                    summary.totals.awaitingReplyCount > 0
                      ? 'text-amber-700'
                      : 'text-slate-800'
                  }`}
                >
                  {toPersianDigits(summary.totals.awaitingReplyCount)}
                </strong>
              </span>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>بروزرسانی</span>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="whitespace-nowrap shrink-0"
            >
              <Link href="/workspace/desk">ورود به میز پشتیبانی</Link>
            </Button>
          </div>
        </div>

        {summary.departments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit max-w-full">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                filter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              همه ({toPersianDigits(summary.departments.length)})
            </button>
            <button
              type="button"
              onClick={() => setFilter('open')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                filter === 'open'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              دارای تیکت باز ({toPersianDigits(openDeptCount)})
            </button>
            <button
              type="button"
              onClick={() => setFilter('awaiting')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                filter === 'awaiting'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              در انتظار پاسخ ({toPersianDigits(awaitingDeptCount)})
            </button>
            {showMemberFilter && (
              <button
                type="button"
                onClick={() => setFilter('member')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  filter === 'member'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                دپارتمان‌های عضویت من ({toPersianDigits(memberCount)})
              </button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {errorMessage && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="font-medium underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
            >
              تلاش مجدد
            </button>
          </div>
        )}

        {summary.departments.length === 0 ? (
          <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Inbox className="h-5 w-5 text-slate-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-800">
                  هنوز دپارتمانی برای نمایش صف تیکت‌ها به شما تخصیص داده نشده است
                </p>
                <p className="text-xs text-slate-500">
                  پس از عضویت در دپارتمان‌ها، آمار تیکت‌های باز و در انتظار پاسخ در
                  این بخش نمایش داده می‌شود.
                </p>
              </div>
            </div>
            {canAdminDepartments && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="whitespace-nowrap shrink-0"
              >
                <Link href="/workspace/admin/departments">مدیریت دپارتمان‌ها</Link>
              </Button>
            )}
          </div>
        ) : filteredDepartments.length === 0 ? (
          <div className="px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              در حال حاضر دپارتمانی مطابق با فیلتر انتخاب‌شده تیکت ندارد.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilter('all')}
              className="whitespace-nowrap shrink-0"
            >
              نمایش همه دپارتمان‌ها
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-3 px-6 font-medium">دپارتمان</th>
                  <th className="py-3 px-4 font-medium text-left">تیکت‌های باز</th>
                  <th className="py-3 px-4 font-medium text-left">
                    در انتظار پاسخ اپراتور
                  </th>
                  <th className="py-3 px-4 font-medium text-left">
                    در انتظار پاسخ مشتری
                  </th>
                  <th className="py-3 px-6 font-medium text-left">صف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDepartments.map((dept) => {
                  const roleLabel = dept.isMember
                    ? dept.isManager
                      ? 'مدیر دپارتمان'
                      : 'اپراتور عضو'
                    : 'دسترسی کل سازمان';
                  return (
                    <tr
                      key={dept.departmentId}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 shrink-0">
                            <DepartmentIcon
                              iconKey={dept.iconKey}
                              className="h-4 w-4 text-blue-700"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">
                              {dept.nameFa}
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-1.5">
                              <span>{roleLabel}</span>
                              {!dept.isActive && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-red-700">غیرفعال</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-left tabular-nums font-medium text-slate-900">
                        {toPersianDigits(dept.openCount)}
                      </td>

                      <td className="py-3 px-4 text-left tabular-nums">
                        <div className="inline-flex flex-col items-end">
                          <span
                            className={
                              dept.awaitingReplyCount > 0
                                ? 'font-semibold text-amber-700'
                                : 'text-slate-600'
                            }
                          >
                            {toPersianDigits(dept.awaitingReplyCount)}
                          </span>
                          {dept.waitingForOperatorCount > 0 && (
                            <span className="text-[11px] text-slate-500">
                              {toPersianDigits(dept.waitingForOperatorCount)} در انتظار
                              تخصیص/پاسخ
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-left tabular-nums text-slate-600">
                        {toPersianDigits(dept.waitingForCustomerCount)}
                      </td>

                      <td className="py-3 px-6 text-left">
                        <Link
                          href={`/workspace/desk/${dept.departmentId}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                        >
                          <span>مشاهده صف</span>
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredDepartments.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-800">
                    <td className="py-2.5 px-6">
                      جمع ({toPersianDigits(filteredDepartments.length)} دپارتمان)
                    </td>
                    <td className="py-2.5 px-4 text-left tabular-nums">
                      {toPersianDigits(filteredTotals.openCount)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-left tabular-nums ${
                        filteredTotals.awaitingReplyCount > 0
                          ? 'text-amber-700'
                          : ''
                      }`}
                    >
                      {toPersianDigits(filteredTotals.awaitingReplyCount)}
                    </td>
                    <td className="py-2.5 px-4 text-left tabular-nums text-slate-600">
                      {toPersianDigits(filteredTotals.waitingForCustomerCount)}
                    </td>
                    <td className="py-2.5 px-6" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
