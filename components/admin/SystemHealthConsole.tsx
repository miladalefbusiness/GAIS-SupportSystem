'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
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
import { formatBytesFa, formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';

export interface SystemHealthData {
  checkedAt: string;
  runtime: {
    appVersion: string;
    phase: number;
    nodeVersion: string;
    nodeEnv: string;
    uptimeSeconds: number;
    memoryRssBytes: number;
    memoryHeapUsedBytes: number;
  };
  database: {
    ok: boolean;
    latencyMs: number;
    pgVersion: string;
    databaseBytes: number;
  };
  storage: {
    ok: boolean;
    driver: string;
    writable: boolean;
    globalMaxBytes: number;
    globalUsedBytes: number;
  };
  integrations: {
    aiConfigured: boolean;
    aiGlobalEnabled: boolean;
    aiProviderType: string;
    aiChatModel: string;
    aiLastTestOk: boolean | null;
    aiLastTestedAt: string | null;
    otpDeliveryMode: string;
    avScannerMode: string;
  };
  counts: {
    users: number;
    departments: number;
    tickets: number;
    ticketMessages: number;
    storedFiles: number;
    knowledgeDocuments: number;
    knowledgeChunks: number;
    knowledgeQaEntries: number;
    auditLogs: number;
    activeStaffSessions: number;
    activeCustomerSessions: number;
  } | null;
}

function formatUptimeFa(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${toPersianDigits(hrs)} ساعت و ${toPersianDigits(mins)} دقیقه و ${toPersianDigits(
    secs
  )} ثانیه`;
}

export function SystemHealthConsole({
  initialData,
}: {
  initialData: SystemHealthData;
}) {
  const [data, setData] = useState<SystemHealthData>(initialData);
  const [loading, setLoading] = useState(false);

  async function refreshHealth() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/health');
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بررسی سلامت سیستم.');
        return;
      }
      setData(json);
      toast.success('وضعیت سلامت سیستم بروزرسانی شد.');
    } catch {
      toast.error('خطای شبکه در بررسی سلامت سیستم.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            سلامت سیستم و اطلاعات عملیاتی
          </h1>
          <p className="text-sm text-slate-600">
            وضعیت زنده اتصال PostgreSQL، دیسک پایدار، مصرف حافظه پردازشگر، نشست‌های فعال و
            وضعیت یکپارچه‌سازی‌ها
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 tabular-nums">
            آخرین پایش: {formatJalaliDateTime(data.checkedAt)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refreshHealth()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>پایش مجدد</span>
          </Button>
        </div>
      </div>

      {/* Infrastructure Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Database className="h-4 w-4 text-blue-700" />
              <span>پایگاه داده PostgreSQL</span>
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              {data.database.ok ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-700" />
              )}
              <span>{data.database.ok ? 'متصل و سالم' : 'خطا در اتصال'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1 tabular-nums">
            <div>تأخیر پاسخ: {toPersianDigits(data.database.latencyMs)} میلی‌ثانیه</div>
            <div>نسخه موتور: {data.database.pgVersion}</div>
            <div>حجم پایگاه داده: {formatBytesFa(data.database.databaseBytes)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <HardDrive className="h-4 w-4 text-blue-700" />
              <span>ذخیره‌سازی فایل پایدار</span>
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              {data.storage.ok && data.storage.writable ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-700" />
              )}
              <span>
                {data.storage.writable ? 'آماده خواندن و نوشتن' : 'غیرقابل نوشتن'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1 tabular-nums">
            <div>درایور فعال: {data.storage.driver}</div>
            <div>مصرف فعلی: {formatBytesFa(data.storage.globalUsedBytes)}</div>
            <div>سقف کل: {formatBytesFa(data.storage.globalMaxBytes)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-blue-700" />
              <span>محیط اجرای سرور</span>
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-indigo-700" />
              <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                v{data.runtime.appVersion}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1 tabular-nums">
            <div>
              Node.js: {data.runtime.nodeVersion} ({data.runtime.nodeEnv})
            </div>
            <div>حافظه RSS: {formatBytesFa(data.runtime.memoryRssBytes)}</div>
            <div>مدت فعالیت: {formatUptimeFa(data.runtime.uptimeSeconds)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Integrations Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">وضعیت یکپارچه‌سازی‌ها و ماژول‌های امنیتی</CardTitle>
          <CardDescription>
            وضعیت بدون افشای کلیدها یا اسرار محیطی
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
            <div className="font-semibold text-slate-900">سرویس هوش مصنوعی</div>
            <div className="text-slate-600">
              وضعیت: {data.integrations.aiGlobalEnabled ? 'فعال' : 'غیرفعال'} · کلید API:{' '}
              {data.integrations.aiConfigured ? 'تنظیم‌شده' : 'تنظیم‌نشده'}
            </div>
            <div
              dir="ltr"
              className="font-[family-name:var(--font-mono)] text-slate-500 text-right"
            >
              {data.integrations.aiProviderType} / {data.integrations.aiChatModel}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
            <div className="font-semibold text-slate-900">ارسال کد تأیید مشتری (OTP)</div>
            <div className="text-slate-600">
              حالت فعلی:{' '}
              <span className="font-[family-name:var(--font-mono)]">
                {data.integrations.otpDeliveryMode}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
            <div className="font-semibold text-slate-900">پویشگر بدافزار آپلود</div>
            <div className="text-slate-600">
              حالت فعلی:{' '}
              <span className="font-[family-name:var(--font-mono)]">
                {data.integrations.avScannerMode}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Database Entity Counts */}
      {data.counts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">آمار زنده جداول و نشست‌های فعال</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {[
              ['کاربران و اپراتورها', data.counts.users],
              ['دپارتمان‌ها', data.counts.departments],
              ['تیکت‌ها', data.counts.tickets],
              ['پیام‌های تیکت', data.counts.ticketMessages],
              ['فایل‌های مخزن اشتراکی', data.counts.storedFiles],
              ['اسناد مخزن دانش', data.counts.knowledgeDocuments],
              ['قطعات متنی دانش', data.counts.knowledgeChunks],
              ['پرسش‌وپاسخ‌های دانش', data.counts.knowledgeQaEntries],
              ['رکوردهای ممیزی', data.counts.auditLogs],
              ['نشست‌های فعال کارکنان', data.counts.activeStaffSessions],
              ['نشست‌های فعال مشتریان', data.counts.activeCustomerSessions],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-slate-200 bg-white p-3 flex items-center justify-between"
              >
                <span className="text-slate-600">{label}</span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {toPersianDigits(Number(val))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
