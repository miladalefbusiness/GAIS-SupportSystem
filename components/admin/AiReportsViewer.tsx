'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FileSearch,
  FlaskConical,
  Loader2,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
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
import type { RagEvaluationRunReport } from '@/src/modules/rag/evaluation/suite';

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
    documentVersion?: number | null;
    pageNumber?: number | null;
    sectionTitle?: string | null;
  }>;
  traceJson?: Record<string, unknown>;
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
  initialEvaluationRuns = [],
}: {
  usageLogs: AiUsageLogViewItem[];
  retrievalRecords: RetrievalRecordViewItem[];
  initialEvaluationRuns?: RagEvaluationRunReport[];
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [evalRuns, setEvalRuns] = useState<RagEvaluationRunReport[]>(
    initialEvaluationRuns
  );
  const [runningEval, setRunningEval] = useState(false);

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

  async function handleRunEvaluation() {
    setRunningEval(true);
    try {
      const res = await fetch('/api/admin/ai/evaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'اجرای ارزیابی ۸ دسته‌ای ناموفق بود.');
        return;
      }
      if (data.report) {
        setEvalRuns((prev) => [data.report, ...prev]);
        toast.success(
          `ارزیابی کامل شد: ${toPersianDigits(data.report.passedCases)} از ${toPersianDigits(data.report.totalCases)} سناریو پاس شد.`
        );
      }
    } catch {
      toast.error('خطای شبکه هنگام اجرای ارزیابی RAG.');
    } finally {
      setRunningEval(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">
          گزارش‌های هوش مصنوعی، ردیابی CRAG و ارزیابی RAG
        </h1>
        <p className="text-sm text-slate-600">
          پایش دقیق راهبرد بازیابی، چرخه‌های اصلاحی CRAG، وفاداری پاسخ و اجرای بنچمارک ۸ دسته‌ای کیفیت RAG
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
            <span>ردیابی بازیابی و CRAG ({toPersianDigits(filteredRetrievals.length)})</span>
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            <span>گزارش فراخوانی مدل ({toPersianDigits(filteredUsageLogs.length)})</span>
          </TabsTrigger>
          <TabsTrigger value="evaluation" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            <span>ارزیابی و بنچمارک RAG ({toPersianDigits(evalRuns.length)})</span>
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
            filteredRetrievals.map((rec) => {
              const trace = rec.traceJson || {};
              const strategy = typeof trace.strategy === 'string' ? trace.strategy : null;
              const cragDecision =
                typeof trace.cragDecision === 'string' ? trace.cragDecision : null;
              const correctiveIterations =
                typeof trace.correctiveIterationsUsed === 'number'
                  ? trace.correctiveIterationsUsed
                  : null;
              const faithfulnessScore =
                typeof trace.faithfulnessScore === 'number'
                  ? trace.faithfulnessScore
                  : null;
              const totalLatencyMs =
                typeof trace.totalLatencyMs === 'number' ? trace.totalLatencyMs : null;

              return (
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
                        {strategy && (
                          <>
                            <span className="text-slate-400">·</span>
                            <span className="font-[family-name:var(--font-mono)] text-blue-700">
                              {strategy}
                            </span>
                          </>
                        )}
                        {cragDecision && (
                          <>
                            <span className="text-slate-400">·</span>
                            <span className="font-[family-name:var(--font-mono)] text-slate-700">
                              CRAG: {cragDecision}
                              {correctiveIterations ? ` (${correctiveIterations} اصلاح)` : ''}
                            </span>
                          </>
                        )}
                        {faithfulnessScore !== null && (
                          <>
                            <span className="text-slate-400">·</span>
                            <span className="text-emerald-700 tabular-nums">
                              وفاداری: {toPersianDigits(faithfulnessScore)}٪
                            </span>
                          </>
                        )}
                        {totalLatencyMs !== null && (
                          <span className="text-slate-500 tabular-nums">
                            ({toPersianDigits(totalLatencyMs)} ms)
                          </span>
                        )}
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
                                {s.documentVersion ? ` · نسخه ${toPersianDigits(s.documentVersion)}` : ''}
                                {s.pageNumber ? ` · صفحه ${toPersianDigits(s.pageNumber)}` : ''}
                                {s.sectionTitle ? ` · ${s.sectionTitle}` : ''}
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
              );
            })
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

        <TabsContent value="evaluation" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    مجموعه بنچمارک ۸ دسته‌ای ارزیابی RAG و CRAG
                  </CardTitle>
                  <CardDescription>
                    سنجش Recall@K، Precision@K، MRR، nDCG، وفاداری پاسخ، دقت استناد و ایمنی در برابر نشت بین دپارتمان‌ها و Prompt Injection
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  disabled={runningEval}
                  onClick={handleRunEvaluation}
                >
                  {runningEval ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  <span>اجرای بنچمارک ۸ دسته‌ای</span>
                </Button>
              </div>
            </CardHeader>
          </Card>

          {evalRuns.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                هنوز هیچ اجرای ارزیابی RAG ثبت نشده است. برای سنجش دقیق عملکرد موتور، دکمه «اجرای بنچمارک ۸ دسته‌ای» را بزنید.
              </CardContent>
            </Card>
          ) : (
            evalRuns.map((run) => (
              <Card key={run.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">
                      {run.runLabel} — {toPersianDigits(run.passedCases)} /{' '}
                      {toPersianDigits(run.totalCases)} موفق
                    </CardTitle>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {formatDateTimeFa(run.createdAt)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-slate-500">Recall@K / Precision@K</div>
                      <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                        {run.recallAtK} / {run.precisionAtK}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-slate-500">MRR / nDCG</div>
                      <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                        {run.mrr} / {run.ndcg}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-slate-500">وفاداری / ارتباط پاسخ</div>
                      <div className="font-semibold text-emerald-700 tabular-nums mt-0.5">
                        {toPersianDigits(Math.round(run.faithfulnessAvg))}٪ /{' '}
                        {toPersianDigits(Math.round(run.answerRelevanceAvg))}٪
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-slate-500">دقت استناد / امتناع امن</div>
                      <div className="font-semibold text-blue-700 tabular-nums mt-0.5">
                        {toPersianDigits(Math.round(run.citationCorrectnessRate * 100))}٪ /{' '}
                        {toPersianDigits(Math.round(run.abstentionAccuracyRate * 100))}٪
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-slate-500">ادعای بی‌اساس / تأخیر</div>
                      <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                        {toPersianDigits(Math.round(run.unsupportedClaimRate * 100))}٪ ·{' '}
                        {toPersianDigits(run.avgLatencyMs)} ms
                      </div>
                    </div>
                  </div>

                  {run.results.length > 0 && (
                    <div className="space-y-1.5">
                      {run.results.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {item.passed ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                            ) : (
                              <ShieldAlert className="h-4 w-4 text-red-600 shrink-0" />
                            )}
                            <span className="font-medium text-slate-900">{item.titleFa}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-600 truncate">{item.reasonFa}</span>
                          </div>
                          <span className="font-[family-name:var(--font-mono)] text-[11px] text-slate-500 tabular-nums">
                            {item.actualOutcome} · CRAG:{item.cragDecision} · {item.latencyMs}ms
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
