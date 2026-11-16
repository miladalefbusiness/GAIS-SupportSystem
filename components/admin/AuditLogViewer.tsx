'use client';

import { useState } from 'react';
import {
  Download,
  Eye,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';

export interface AuditLogItemDto {
  id: string;
  action: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditViewerData {
  items: AuditLogItemDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  targetTypes: string[];
}

export function AuditLogViewer({
  initialData,
}: {
  initialData: AuditViewerData;
}) {
  const [data, setData] = useState<AuditViewerData>(initialData);
  const [q, setQ] = useState('');
  const [actionPrefix, setActionPrefix] = useState('');
  const [actorType, setActorType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [loading, setLoading] = useState(false);
  const [inspectItem, setInspectItem] = useState<AuditLogItemDto | null>(null);

  async function fetchAuditPage(
    nextPage = 1,
    overrides?: {
      q?: string;
      actionPrefix?: string;
      actorType?: string;
      targetType?: string;
    }
  ) {
    setLoading(true);
    try {
      const nextQ = overrides?.q ?? q;
      const nextAction = overrides?.actionPrefix ?? actionPrefix;
      const nextActor = overrides?.actorType ?? actorType;
      const nextTarget = overrides?.targetType ?? targetType;

      const qs = new URLSearchParams();
      qs.set('page', String(nextPage));
      qs.set('pageSize', '25');
      if (nextQ.trim()) qs.set('q', nextQ.trim());
      if (nextAction) qs.set('action', nextAction);
      if (nextActor) qs.set('actorType', nextActor);
      if (nextTarget) qs.set('targetType', nextTarget);

      const res = await fetch(`/api/admin/audit?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در دریافت لاگ‌های ممیزی.');
        return;
      }
      setData(json);
    } catch {
      toast.error('خطای شبکه در دریافت لاگ‌های ممیزی.');
    } finally {
      setLoading(false);
    }
  }

  function exportAuditUrl() {
    const qs = new URLSearchParams();
    qs.set('kind', 'audit');
    if (q.trim()) qs.set('q', q.trim());
    if (actionPrefix) qs.set('action', actionPrefix);
    if (actorType) qs.set('actorType', actorType);
    if (targetType) qs.set('targetType', targetType);
    return `/api/admin/reports/export?${qs.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">گزارش ممیزی امنیتی سیستم</h1>
          <p className="text-sm text-slate-600">
            بررسی تمام رویدادهای احراز هویت، تغییرات مجوز، تیکتینگ، مخزن فایل، هوش مصنوعی و
            تنظیمات مدیریتی
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportAuditUrl()}>
              <Download className="h-4 w-4" />
              <span>خروجی CSV</span>
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchAuditPage(data.pagination.page)}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>بروزرسانی</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100 pb-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchAuditPage(1);
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5"
          >
            <div className="relative lg:col-span-2">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جستجو در رویداد، نام کاربر، شناسه هدف یا IP..."
                className="h-9 pr-9 text-xs"
              />
            </div>

            <select
              aria-label="فیلتر حوزه رویداد"
              value={actionPrefix}
              onChange={(e) => setActionPrefix(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="">همه حوزه‌های رویداد</option>
              <option value="auth.">احراز هویت کارکنان (auth.*)</option>
              <option value="customer.">احراز هویت مشتری (customer.*)</option>
              <option value="ticket.">تیکتینگ و پاسخگویی (ticket.*)</option>
              <option value="files.">مخزن فایل اشتراکی (files.*)</option>
              <option value="admin.">تنظیمات و مدیریت (admin.*)</option>
              <option value="kb.">مخزن دانش (kb.*)</option>
              <option value="ai.">هوش مصنوعی (ai.*)</option>
            </select>

            <select
              aria-label="فیلتر عامل"
              value={actorType}
              onChange={(e) => setActorType(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="">همه عامل‌ها</option>
              <option value="user">کاربر (user)</option>
              <option value="system">سیستم (system)</option>
              <option value="anonymous">ناشناس (anonymous)</option>
            </select>

            <div className="flex items-center gap-2">
              <select
                aria-label="فیلتر نوع هدف"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="flex-1 min-w-0 h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="">همه اهداف</option>
                {data.targetTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" className="h-9 whitespace-nowrap">
                اعمال
              </Button>
              {(q || actionPrefix || actorType || targetType) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-slate-500"
                  title="پاک کردن فیلترها"
                  onClick={() => {
                    setQ('');
                    setActionPrefix('');
                    setActorType('');
                    setTargetType('');
                    void fetchAuditPage(1, {
                      q: '',
                      actionPrefix: '',
                      actorType: '',
                      targetType: '',
                    });
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </form>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-blue-700" />
              <span>
                مجموع رکوردهای منطبق: {toPersianDigits(data.pagination.total)}
              </span>
            </span>
            <span className="tabular-nums">
              صفحه {toPersianDigits(data.pagination.page)} از{' '}
              {toPersianDigits(data.pagination.totalPages)}
            </span>
          </div>

          {data.items.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              رویدادی مطابق فیلترهای انتخاب‌شده یافت نشد.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm text-right border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">رویداد</th>
                    <th className="py-2.5 px-3 font-medium">عامل</th>
                    <th className="py-2.5 px-3 font-medium">هدف</th>
                    <th className="py-2.5 px-3 font-medium">IP</th>
                    <th className="py-2.5 px-3 font-medium">زمان (شمسی)</th>
                    <th className="py-2.5 px-3 font-medium text-left">جزئیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td
                        dir="ltr"
                        className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-900 text-right"
                      >
                        {item.action}
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {item.actorName ? (
                          <div>
                            <div className="font-medium text-slate-900">
                              {item.actorName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-[family-name:var(--font-mono)]">
                              @{item.actorUsername}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">{item.actorType}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700">
                        <div>{item.targetType || '—'}</div>
                        {item.targetId && (
                          <div
                            dir="ltr"
                            className="text-[11px] text-slate-500 font-[family-name:var(--font-mono)] text-right truncate max-w-36"
                          >
                            {item.targetId}
                          </div>
                        )}
                      </td>
                      <td
                        dir="ltr"
                        className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-600 text-right tabular-nums"
                      >
                        {item.ipAddress || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatJalaliDateTime(item.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 text-left">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setInspectItem(item)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || data.pagination.page <= 1}
                onClick={() => void fetchAuditPage(data.pagination.page - 1)}
              >
                صفحه قبل
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || data.pagination.page >= data.pagination.totalPages}
                onClick={() => void fetchAuditPage(data.pagination.page + 1)}
              >
                صفحه بعد
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(inspectItem)}
        onOpenChange={(open) => {
          if (!open) setInspectItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>جزئیات رویداد ممیزی</DialogTitle>
            <DialogDescription>
              فراداده‌های فنی و امنیتی ثبت‌شده برای این رویداد
            </DialogDescription>
          </DialogHeader>
          {inspectItem && (
            <div className="space-y-3 text-xs">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5">
                <div>
                  <span className="text-slate-500">شناسه رویداد: </span>
                  <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                    {inspectItem.id}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">عملیات: </span>
                  <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                    {inspectItem.action}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">User-Agent: </span>
                  <span
                    dir="ltr"
                    className="font-[family-name:var(--font-mono)] break-all"
                  >
                    {inspectItem.userAgent || '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="font-semibold text-slate-700">فراداده (Metadata)</div>
                <pre
                  dir="ltr"
                  className="rounded-lg bg-slate-900 text-slate-100 p-3 text-[11px] font-[family-name:var(--font-mono)] overflow-x-auto"
                >
                  {JSON.stringify(inspectItem.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
