'use client';

import { BarChart3, CheckCircle2, FileSearch, ShieldAlert } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  const successCount = usageLogs.filter((l) => l.status === 'success').length;
  const abstainedCount = usageLogs.filter((l) => l.status === 'abstained').length;
  const errorCount = usageLogs.filter((l) => l.status === 'provider_error').length;
  const escalatedCount = usageLogs.filter((l) => l.status === 'escalated').length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">
          گزارش‌های هوش مصنوعی و ردیابی منابع
        </h1>
        <p className="text-sm text-slate-600">
          بررسی دقت بازیابی دانش، موارد عدم قطعیت (Abstention)، نرخ خطای ارائه‌دهنده و درخواست‌های ارتباط با اپراتور
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
            <CardDescription>امتناع امن (Abstained)</CardDescription>
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

      <Tabs defaultValue="retrievals" className="space-y-4">
        <TabsList>
          <TabsTrigger value="retrievals" className="gap-1.5">
            <FileSearch className="h-4 w-4" />
            <span>ردیابی منابع بازیابی‌شده ({toPersianDigits(retrievalRecords.length)})</span>
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            <span>گزارش فراخوانی مدل ({toPersianDigits(usageLogs.length)})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="retrievals" className="space-y-3">
          {retrievalRecords.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                هنوز هیچ رکورد بازیابی دانشی ثبت نشده است.
              </CardContent>
            </Card>
          ) : (
            retrievalRecords.map((rec) => (
              <Card key={rec.id}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {rec.abstained ? (
                        <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-900">
                        دپارتمان: {rec.departmentNameFa}
                      </span>
                      <span className="text-slate-500">·</span>
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
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-900">
                              [{s.sourceType === 'qa' ? 'پرسش‌وپاسخ' : 'قطعه سند'}] {s.title}
                            </span>
                            <span className="font-[family-name:var(--font-mono)] text-blue-700 tabular-nums">
                              score={s.score}
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
          {usageLogs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                هنوز گزارش فراخوانی مدلی ثبت نشده است.
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
                      <th className="px-4 py-3 font-medium">توکن</th>
                      <th className="px-4 py-3 font-medium">کد رویداد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {usageLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 text-slate-500 tabular-nums whitespace-nowrap">
                          {formatDateTimeFa(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-900 font-medium">
                          {log.departmentNameFa}
                        </td>
                        <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-slate-700">
                          {log.modelName}
                        </td>
                        <td className="px-4 py-3">
                          {STATUS_LABELS[log.status] || log.status}
                        </td>
                        <td className="px-4 py-3 font-[family-name:var(--font-mono)] tabular-nums">
                          {log.latencyMs}ms
                        </td>
                        <td className="px-4 py-3 font-[family-name:var(--font-mono)] tabular-nums text-slate-600">
                          {log.promptTokens ?? '—'} / {log.completionTokens ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-slate-500">
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
