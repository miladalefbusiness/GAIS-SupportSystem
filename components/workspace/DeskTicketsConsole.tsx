'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Loader2,
  RefreshCw,
  Search,
  Ticket,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toPersianDigits } from '@/src/lib/jalali';
import {
  TICKET_PRIORITY_LABEL_FA,
  TICKET_STATUS_LABEL_FA,
  type TicketPriority,
  type TicketStatus,
} from '@/src/modules/tickets/schemas';

interface TicketQueueRow {
  id: string;
  referenceCode: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  conversationMode: string;
  aiAutoReplyEnabled: boolean;
  departmentId: string;
  departmentNameFa: string;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  customerRef: string;
  customerName: string;
  hasAiOrigin: boolean;
  lastMessageAt: string;
  createdAt: string;
}

function formatDateTimeFa(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DeskTicketsConsole({
  departmentId,
  title = 'صف تیکت‌های پشتیبانی',
}: {
  departmentId?: string;
  title?: string;
}) {
  const [tab, setTab] = useState<'department' | 'mine' | 'unassigned'>('department');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'priority'>('newest');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<TicketQueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ mine: 0, department: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);

  const buildQueueUrl = useCallback(() => {
    const qs = new URLSearchParams({
      tab,
      status,
      priority,
      sort,
      page: String(page),
      pageSize: '15',
    });
    if (departmentId) qs.set('departmentId', departmentId);
    if (appliedQuery) qs.set('q', appliedQuery);
    return `/api/workspace/tickets?${qs.toString()}`;
  }, [tab, status, priority, sort, page, departmentId, appliedQuery]);

  async function fetchQueue() {
    setLoading(true);
    try {
      const res = await fetch(buildQueueUrl());
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total ?? 0));
      if (data.counts) {
        setCounts(data.counts);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch(buildQueueUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total ?? 0));
        if (data.counts) {
          setCounts(data.counts);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [buildQueueUrl]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedQuery(searchInput.trim());
  }

  const hasActiveFilters =
    status !== 'all' || priority !== 'all' || sort !== 'newest' || Boolean(appliedQuery);

  function resetFilters() {
    setStatus('all');
    setPriority('all');
    setSort('newest');
    setSearchInput('');
    setAppliedQuery('');
    setPage(1);
  }

  return (
    <Card className="bg-white">
      <CardHeader className="border-b border-slate-100 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-blue-700" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
              >
                پاک کردن فیلترها
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchQueue()}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>بروزرسانی</span>
            </Button>
          </div>
        </div>

        {/* Queue Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTab('mine');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              tab === 'mine'
                ? 'bg-blue-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            تیکت‌های من ({toPersianDigits(counts.mine)})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('department');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              tab === 'department'
                ? 'bg-blue-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            صف مجاز ({toPersianDigits(counts.department)})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('unassigned');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              tab === 'unassigned'
                ? 'bg-blue-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            در انتظار تخصیص ({toPersianDigits(counts.unassigned)})
          </button>
        </div>

        {/* Filters & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <form onSubmit={handleSearchSubmit} className="lg:col-span-2 flex gap-2">
            <Input
              placeholder="جست‌وجو با کد پیگیری، موضوع یا نام مشتری..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" variant="outline" size="sm" className="h-10 px-3">
              <Search className="h-4 w-4" />
            </Button>
          </form>

          <select
            aria-label="فیلتر وضعیت"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="waiting_for_operator">در انتظار اپراتور</option>
            <option value="assigned">تخصیص‌یافته</option>
            <option value="in_progress">در حال بررسی</option>
            <option value="waiting_for_customer">در انتظار پاسخ مشتری</option>
            <option value="resolved">حل‌شده</option>
            <option value="closed">بسته‌شده</option>
          </select>

          <select
            aria-label="فیلتر اولویت"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="urgent">فوری</option>
            <option value="high">بالا</option>
            <option value="normal">عادی</option>
            <option value="low">کم</option>
          </select>

          <select
            aria-label="مرتب‌سازی"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as 'newest' | 'oldest' | 'priority');
              setPage(1);
            }}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="newest">جدیدترین پیام</option>
            <option value="oldest">قدیمی‌ترین</option>
            <option value="priority">اولویت</option>
          </select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
            <span>در حال بارگذاری تیکت‌ها...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            تیکتی مطابق فیلترهای انتخابی در این صف یافت نشد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">کد پیگیری</th>
                  <th className="py-2.5 px-4 font-medium">عنوان</th>
                  <th className="py-2.5 px-4 font-medium">مشتری</th>
                  {!departmentId && (
                    <th className="py-2.5 px-4 font-medium">دپارتمان</th>
                  )}
                  <th className="py-2.5 px-4 font-medium">وضعیت / اولویت</th>
                  <th className="py-2.5 px-4 font-medium">اپراتور مسئول</th>
                  <th className="py-2.5 px-4 font-medium">آخرین فعالیت</th>
                  <th className="py-2.5 px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link
                        href={`/workspace/desk/tickets/${t.id}`}
                        dir="ltr"
                        className="font-[family-name:var(--font-mono)] text-xs font-semibold text-blue-700 hover:underline"
                      >
                        {t.referenceCode}
                      </Link>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <Link
                        href={`/workspace/desk/tickets/${t.id}`}
                        className="font-medium text-slate-900 hover:text-blue-700 line-clamp-1 flex items-center gap-1.5"
                      >
                        {t.hasAiOrigin && (
                          <Bot
                            className="h-3.5 w-3.5 text-blue-700 shrink-0"
                            aria-label="ارجاع از دستیار هوشمند"
                          />
                        )}
                        <span>{t.subject}</span>
                      </Link>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-700">
                      <div>{t.customerName}</div>
                      <div
                        dir="ltr"
                        className="text-[11px] font-[family-name:var(--font-mono)] text-slate-400 text-right"
                      >
                        {t.customerRef}
                      </div>
                    </td>
                    {!departmentId && (
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-700">
                        {t.departmentNameFa}
                      </td>
                    )}
                    <td className="py-3 px-4 whitespace-nowrap text-xs">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-800">
                          {TICKET_STATUS_LABEL_FA[t.status] || t.status}
                        </span>
                        <span
                          className={`text-[11px] ${
                            t.priority === 'urgent'
                              ? 'text-red-700 font-semibold'
                              : t.priority === 'high'
                              ? 'text-amber-700 font-medium'
                              : 'text-slate-500'
                          }`}
                        >
                          اولویت: {TICKET_PRIORITY_LABEL_FA[t.priority] || t.priority}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-700">
                      {t.assignedOperatorName || (
                        <span className="text-amber-700">در انتظار تخصیص</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-500 tabular-nums">
                      {formatDateTimeFa(t.lastMessageAt)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/workspace/desk/tickets/${t.id}`}>
                          <span>بررسی</span>
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 15 && (
          <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between text-xs text-slate-600">
            <span className="tabular-nums">
              مجموع تیکت‌ها: {toPersianDigits(total)} · صفحه {toPersianDigits(page)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                صفحه قبل
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page * 15 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                صفحه بعد
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
