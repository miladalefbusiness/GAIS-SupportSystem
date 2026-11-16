'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FileSearch,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toPersianDigits } from '@/src/lib/jalali';

export interface AiUsageLogViewItem {
  id: string;
  departmentNameFa: string;
  conversationId: string | null;
  providerType: string;
  modelName: string;
  status: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface RetrievalRecordViewItem {
  id: string;
  departmentNameFa: string;
  conversationId: string;
  queryText: string;
  sourcesJson: Array<{
    sourceType: string;
    sourceId: string;
    title: string;
    score: number;
    snippet: string;
  }>;
  topScore: number;
  abstained: boolean;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  success: 'پاسخ موفق',
  abstained: 'عدم قطعیت / رد خودکار',
  provider_error: 'خطای سرویس‌دهنده',
  escalated: 'ارجاع به اپراتور',
  rate_limited: 'محدودیت سقف',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  success: 'text-emerald-700 font-medium',
  abstained: 'text-amber-700 font-medium',
  provider_error: 'text-red-700 font-medium',
  escalated: 'text-blue-700 font-medium',
  rate_limited: 'text-orange-700 font-medium',
};

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

export function AiReportsViewer({
  usageLogs,
  retrievalRecords,
}: {
  usageLogs: AiUsageLogViewItem[];
  retrievalRecords: RetrievalRecordViewItem[];
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const successCount = usageLogs.filter((l) => l.status === 'success').length;
  const abstainedCount = usageLogs.filter((l) => l.status === 'abstained').length;
  const errorCount = usageLogs.filter((l) => l.status === 'provider_error').length;
  const escalatedCount = usageLogs.filter((l) => l.status === 'escalated').length;

  const filteredRetrievals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return retrievalRecords.filter((rec) => {
      if (statusFilter === 'abstained' && !rec.abstained) return false;
      if (statusFilter === 'success' && rec.abstained) return false;
      if (!q) return true;
      return (
        rec.queryText.toLowerCase().includes(q) ||
        rec.departmentNameFa.toLowerCase().includes(q) ||
        rec.sourcesJson.some((s) => s.title.toLowerCase().includes(q))
      );
    });
  }, [retrievalRecords, search, statusFilter]);

  const filteredUsageLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return usageLogs.filter((log) => {
      if (statusFilter !== 'all' && log.status !== statusFilter) return false;
      if (!q) return true;
      return (
        log.departmentNameFa.toLowerCase().includes(q) ||
        log.modelName.toLowerCase().includes(q) ||
        (log.errorCode || '').toLowerCase().includes(q)
      );
    });
  }, [usageLogs, search, statusFilter]);

  const hasFilters = Boolean(search.trim() || statusFilter !== 'all');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">
          گزارش‌های هوش مصنوعی و ردیابی منابع
        </h1>
        <p className="text-sm text-slate-600">
          بررسی دقت بازیابی دانش، موارد عدم قطعیت، نرخ خطای ارائه‌دهنده و درخواست‌های ارتباط با اپراتور
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>پاسخ‌های متکی بر سند</CardDescription>
            <CardTitle className="text-2xl text-emerald-700 tabular-nums">
              {toPersianDigits(successCount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>امتناع امن</CardDescription>
            <CardTitle className="text-2xl text-amber-700 tabular-nums">
              {toPersianDigits(abstainedCount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ارجاع به اپراتور</CardDescription>
            <CardTitle className="text-2xl text-blue-700 tabular-nums">
              {toPersianDigits(escalatedCount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>خطاهای ارائه‌دهنده</CardDescription>
            <CardTitle className="text-2xl text-red-700 tabular-nums">
              {toPersianDigits(errorCount)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در پرسش، عنوان سند، دپارتمان یا نام مدل..."
            className="h-9 pr-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="فیلتر وضعیت"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="success">پاسخ موفق</option>
            <option value="abstained">امتناع امن</option>
            <option value="escalated">ارجاع به اپراتور</option>
            <option value="provider_error">خطای سرویس‌دهنده</option>
            <option value="rate_limited">محدودیت سقف</option>
          </select>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>پاک کردن</span>
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="retrievals" className="space-y-4">
        <TabsList>
          <TabsTrigger value="retrievals" className="gap-1.5">
            <FileSearch className="h-4 w-4" />
            <span>ردیابی منابع بازیابی‌شده ({toPersianDigits(filteredRetrievals.length)})</span>
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            <span>گزارش فراخوانی مدل ({toPersianDigits(filteredUsageLogs.length)})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="retrievals" className="space-y-3">
          {filteredRetrievals.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                {retrievalRecords.length === 0
                  ? 'هنوز هیچ رکورد بازیابی دانشی ثبت نشده است.'
                  : 'رکوردی مطابق فیلتر انتخاب‌شده یافت نشد.'}
              </CardContent>
            </Card>
          ) : (
            filteredRetrievals.map((rec) => (
              <Card key={rec.id}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {rec.abstained ? (
                        <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-900">
                        دپارتمان: {rec.departmentNameFa}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="tabular-nums text-slate-600">
                        بالاترین امتیاز: {toPersianDigits(rec.topScore)}
                      </span>
                    </div>
                    <span className="text-slate-500 tabular-nums">
                      {formatDateTimeFa(rec.createdAt)}
                    </span>
                  </div>

                  <p className="text-sm text-slate-800">پرسش: {rec.queryText}</p>

                  {rec.sourcesJson.length > 0 && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2">
                      {rec.sourcesJson.map((s) => (
                        <div
                          key={s.sourceId}
                          className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs space-y-0.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-900">
                              [{s.sourceType === 'qa' ? 'پرسش‌وپاسخ' : 'قطعه سند'}] {s.title}
                            </span>
                            <span className="text-blue-700 font-medium tabular-nums">
                              امتیاز: {toPersianDigits(s.score)}
                            </span>
                          </div>
                          <p className="text-slate-600 line-clamp-2">{s.snippet}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="usage" className="space-y-3">
          {filteredUsageLogs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                {usageLogs.length === 0
                  ? 'هنوز گزارش فراخوانی مدلی ثبت نشده است.'
                  : 'گزارشی مطابق فیلتر انتخاب‌شده یافت نشد.'}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">زمان</th>
                      <th className="px-4 py-3 font-medium">دپارتمان</th>
                      <th className="px-4 py-3 font-medium">مدل</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      <th className="px-4 py-3 font-medium">تأخیر</th>
                      <th className="px-4 py-3 font-medium">توکن (ورودی / خروجی)</th>
                      <th className="px-4 py-3 font-medium">کد رویداد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredUsageLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 text-slate-500 tabular-nums whitespace-nowrap">
                          {formatDateTimeFa(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-900 font-medium">
                          {log.departmentNameFa}
                        </td>
                        <td
                          dir="ltr"
                          className="px-4 py-3 font-[family-name:var(--font-mono)] text-slate-700 text-right"
                        >
                          {log.modelName}
                        </td>
                        <td className="px-4 py-3">
                          <span className={STATUS_TEXT_COLORS[log.status] || 'text-slate-700'}>
                            {STATUS_LABELS[log.status] || log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap text-slate-700">
                          {toPersianDigits(log.latencyMs)} میلی‌ثانیه
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-600 whitespace-nowrap">
                          {log.promptTokens !== null ? toPersianDigits(log.promptTokens) : '—'} /{' '}
                          {log.completionTokens !== null
                            ? toPersianDigits(log.completionTokens)
                            : '—'}
                        </td>
                        <td
                          dir="ltr"
                          className="px-4 py-3 font-[family-name:var(--font-mono)] text-slate-500 text-right"
                        >
                          {log.errorCode || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
