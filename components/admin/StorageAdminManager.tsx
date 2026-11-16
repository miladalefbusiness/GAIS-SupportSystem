'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  HardDrive,
  History,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytesFa, formatJalaliDateTime, toPersianDigits } from '@/src/lib/jalali';
import {
  SHARED_FILE_EXTENSION_CATALOG,
  type SupportedSharedFileExtension,
} from '@/src/modules/files/schemas';

export interface StorageOverviewData {
  storageHealth: {
    ok: boolean;
    driver: string;
    writable: boolean;
  };
  globalQuota: {
    maxBytes: number;
    usedBytes: number;
    recordedUsedBytes: number;
    totalFiles: number;
  };
  policy: {
    allowedExtensions: SupportedSharedFileExtension[];
    maxUploadSizeMb: number;
  };
  departmentUsage: Array<{
    departmentId: string;
    nameFa: string;
    slug: string;
    isActive: boolean;
    maxUploadSizeMb: number;
    fileCount: number;
    usedBytes: number;
    quotaMaxBytes: number | null;
  }>;
  operatorUsage: Array<{
    userId: string;
    name: string;
    username: string;
    status: string;
    fileCount: number;
    usedBytes: number;
    quotaMaxBytes: number | null;
  }>;
  permissions: Array<{
    id: string;
    departmentId: string;
    departmentName: string;
    folderId: string | null;
    fileId: string | null;
    targetType: string;
    targetId: string;
    targetLabel: string;
    canView: boolean;
    canDownload: boolean;
    canUpload: boolean;
    canManage: boolean;
    note: string | null;
    createdAt: string;
  }>;
  recentAudit: Array<{
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    actorName: string | null;
    actorUsername: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
}

export function StorageAdminManager({
  initialOverview,
}: {
  initialOverview: StorageOverviewData;
}) {
  const [overview, setOverview] = useState<StorageOverviewData>(initialOverview);
  const [refreshing, setRefreshing] = useState(false);

  // Global quota edit
  const [globalMaxMb, setGlobalMaxMb] = useState(
    String(Math.max(1, Math.round(initialOverview.globalQuota.maxBytes / (1024 * 1024))))
  );
  const [savingQuotaKey, setSavingQuotaKey] = useState<string | null>(null);

  // Department & Operator quota inputs
  const [deptQuotaInputs, setDeptQuotaInputs] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const d of initialOverview.departmentUsage) {
      map[d.departmentId] = d.quotaMaxBytes
        ? String(Math.round(d.quotaMaxBytes / (1024 * 1024)))
        : '';
    }
    return map;
  });
  const [opQuotaInputs, setOpQuotaInputs] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const o of initialOverview.operatorUsage) {
      map[o.userId] = o.quotaMaxBytes
        ? String(Math.round(o.quotaMaxBytes / (1024 * 1024)))
        : '';
    }
    return map;
  });

  // Policy form
  const [allowedExts, setAllowedExts] = useState<SupportedSharedFileExtension[]>(
    initialOverview.policy.allowedExtensions
  );
  const [maxUploadMb, setMaxUploadMb] = useState(
    String(initialOverview.policy.maxUploadSizeMb)
  );
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Granular permission form
  const [permDeptId, setPermDeptId] = useState(
    initialOverview.departmentUsage[0]?.departmentId || ''
  );
  const [permTargetType, setPermTargetType] = useState<'user' | 'department'>('user');
  const [permTargetId, setPermTargetId] = useState(
    initialOverview.operatorUsage[0]?.userId || ''
  );
  const [permCanView, setPermCanView] = useState(true);
  const [permCanDownload, setPermCanDownload] = useState(true);
  const [permCanUpload, setPermCanUpload] = useState(false);
  const [permCanManage, setPermCanManage] = useState(false);
  const [permNote, setPermNote] = useState('');
  const [savingPerm, setSavingPerm] = useState(false);

  async function refreshOverview() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/storage');
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بروزرسانی اطلاعات ذخیره‌سازی.');
        return;
      }
      setOverview(json);
    } catch {
      toast.error('خطای شبکه در دریافت اطلاعات ذخیره‌سازی.');
    } finally {
      setRefreshing(false);
    }
  }

  async function saveQuota(
    scopeType: 'global' | 'department' | 'operator',
    scopeId: string,
    rawMb: string
  ) {
    const maxMb = Number(rawMb);
    if (!Number.isFinite(maxMb) || maxMb < 1) {
      toast.error('مقدار سهمیه باید عددی حداقل برابر ۱ مگابایت باشد.');
      return;
    }
    const key = `${scopeType}:${scopeId}`;
    setSavingQuotaKey(key);
    try {
      const res = await fetch('/api/admin/storage/quotas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeType, scopeId, maxMb }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ثبت سهمیه.');
        return;
      }
      toast.success('سهمیه ذخیره‌سازی با موفقیت بروزرسانی شد.');
      await refreshOverview();
    } catch {
      toast.error('خطای شبکه در ثبت سهمیه.');
    } finally {
      setSavingQuotaKey(null);
    }
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (allowedExts.length === 0) {
      toast.error('حداقل یک پسوند مجاز را انتخاب کنید.');
      return;
    }
    setSavingPolicy(true);
    try {
      const res = await fetch('/api/admin/storage/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedExtensions: allowedExts,
          maxUploadSizeMb: Number(maxUploadMb),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ذخیره سیاست فایل‌ها.');
        return;
      }
      toast.success('سیاست انواع فایل و سقف بارگذاری ذخیره شد.');
      await refreshOverview();
    } catch {
      toast.error('خطای شبکه در ذخیره سیاست فایل‌ها.');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleGrantPermission(e: React.FormEvent) {
    e.preventDefault();
    if (!permDeptId || !permTargetId) {
      toast.error('دپارتمان و هدف دسترسی را انتخاب کنید.');
      return;
    }
    setSavingPerm(true);
    try {
      const res = await fetch('/api/admin/storage/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId: permDeptId,
          targetType: permTargetType,
          targetId: permTargetId,
          canView: permCanView,
          canDownload: permCanDownload,
          canUpload: permCanUpload,
          canManage: permCanManage,
          note: permNote.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ثبت قانون دسترسی.');
        return;
      }
      toast.success('استثنای دسترسی فایل ثبت شد.');
      setPermNote('');
      await refreshOverview();
    } catch {
      toast.error('خطای شبکه در ثبت قانون دسترسی.');
    } finally {
      setSavingPerm(false);
    }
  }

  async function handleRevokePermission(id: string) {
    try {
      const res = await fetch(
        `/api/admin/storage/permissions?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در حذف قانون دسترسی.');
        return;
      }
      toast.success('قانون دسترسی حذف شد.');
      await refreshOverview();
    } catch {
      toast.error('خطای شبکه در حذف قانون دسترسی.');
    }
  }

  const globalPct =
    overview.globalQuota.maxBytes > 0
      ? Math.min(
          100,
          Math.round(
            (overview.globalQuota.usedBytes / overview.globalQuota.maxBytes) * 100
          )
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            مدیریت ذخیره‌سازی، سهمیه‌ها و ممیزی فایل
          </h1>
          <p className="text-sm text-slate-600">
            کنترل ظرفیت کل سازمان، سهمیه دپارتمان‌ها و اپراتورها، سیاست فایل‌های مجاز و
            استثناهای دسترسی
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refreshOverview()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span>بروزرسانی آمار</span>
        </Button>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>وضعیت درایور ذخیره‌سازی</CardDescription>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2
                className={`h-4 w-4 ${
                  overview.storageHealth.writable ? 'text-emerald-700' : 'text-red-700'
                }`}
              />
              <span>
                {overview.storageHealth.writable ? 'آماده نوشتن (پایدار)' : 'خطا در دیسک'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            درایور فعال: {overview.storageHealth.driver}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>مصرف کل مخزن فایل</CardDescription>
            <CardTitle className="text-base tabular-nums">
              {formatBytesFa(overview.globalQuota.usedBytes)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(globalPct)}٪ از{' '}
            {formatBytesFa(overview.globalQuota.maxBytes)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>تعداد فایل‌های مخزن</CardDescription>
            <CardTitle className="text-base tabular-nums">
              {toPersianDigits(overview.globalQuota.totalFiles)} فایل
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            با احتساب نسخه‌های آرشیوشده
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>سقف بارگذاری هر فایل</CardDescription>
            <CardTitle className="text-base tabular-nums">
              {toPersianDigits(overview.policy.maxUploadSizeMb)} مگابایت
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500 tabular-nums">
            {toPersianDigits(overview.policy.allowedExtensions.length)} پسوند مجاز
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="quotas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="quotas">سهمیه‌های حجمی</TabsTrigger>
          <TabsTrigger value="policy">سیاست فایل‌ها</TabsTrigger>
          <TabsTrigger value="permissions">استثناهای دسترسی</TabsTrigger>
          <TabsTrigger value="audit">گزارش ممیزی فایل</TabsTrigger>
        </TabsList>

        {/* Tab 1: Quotas */}
        <TabsContent value="quotas" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-blue-700" />
                <span>سقف کل ذخیره‌سازی سازمان</span>
              </CardTitle>
              <CardDescription>
                تعیین حداکثر فضای قابل استفاده برای کل فایل‌های اشتراکی سازمان
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 w-52">
                <Label htmlFor="global-max-mb">سقف ظرفیت کل (مگابایت)</Label>
                <Input
                  id="global-max-mb"
                  type="number"
                  min={1}
                  value={globalMaxMb}
                  onChange={(e) => setGlobalMaxMb(e.target.value)}
                />
              </div>
              <Button
                type="button"
                disabled={savingQuotaKey === 'global:global'}
                onClick={() => void saveQuota('global', 'global', globalMaxMb)}
              >
                {savingQuotaKey === 'global:global' && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                <span>ذخیره سقف کل</span>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">مصرف و سهمیه دپارتمان‌ها</CardTitle>
              <CardDescription>
                میزان مصرف واقعی هر دپارتمان و تنظیم سقف حجمی مجزا
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-3 font-medium">دپارتمان</th>
                    <th className="py-2.5 px-3 font-medium">تعداد فایل</th>
                    <th className="py-2.5 px-3 font-medium">حجم مصرف‌شده</th>
                    <th className="py-2.5 px-3 font-medium">سهمیه فعلی</th>
                    <th className="py-2.5 px-3 font-medium">تنظیم سهمیه (MB)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.departmentUsage.map((dept) => {
                    const key = `department:${dept.departmentId}`;
                    return (
                      <tr key={dept.departmentId}>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {dept.nameFa}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {toPersianDigits(dept.fileCount)}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {formatBytesFa(dept.usedBytes)}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {dept.quotaMaxBytes
                            ? formatBytesFa(dept.quotaMaxBytes)
                            : 'بدون محدودیت مجزا'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              placeholder="مثلاً 500"
                              className="h-8 w-28 text-xs"
                              value={deptQuotaInputs[dept.departmentId] ?? ''}
                              onChange={(e) =>
                                setDeptQuotaInputs((prev) => ({
                                  ...prev,
                                  [dept.departmentId]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={savingQuotaKey === key}
                              onClick={() =>
                                void saveQuota(
                                  'department',
                                  dept.departmentId,
                                  deptQuotaInputs[dept.departmentId] || ''
                                )
                              }
                            >
                              ثبت
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">مصرف و سهمیه اپراتورها</CardTitle>
              <CardDescription>
                پایش حجم فایل‌های بارگذاری‌شده توسط هر اپراتور و تعیین سقف فردی
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2.5 px-3 font-medium">اپراتور</th>
                    <th className="py-2.5 px-3 font-medium">تعداد فایل</th>
                    <th className="py-2.5 px-3 font-medium">حجم مصرف‌شده</th>
                    <th className="py-2.5 px-3 font-medium">سهمیه فعلی</th>
                    <th className="py-2.5 px-3 font-medium">تنظیم سهمیه (MB)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.operatorUsage.map((op) => {
                    const key = `operator:${op.userId}`;
                    return (
                      <tr key={op.userId}>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">{op.name}</div>
                          <div className="text-[11px] text-slate-500 font-[family-name:var(--font-mono)]">
                            @{op.username}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {toPersianDigits(op.fileCount)}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {formatBytesFa(op.usedBytes)}
                        </td>
                        <td className="py-2.5 px-3 text-xs tabular-nums">
                          {op.quotaMaxBytes
                            ? formatBytesFa(op.quotaMaxBytes)
                            : 'بدون محدودیت مجزا'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              placeholder="مثلاً 100"
                              className="h-8 w-28 text-xs"
                              value={opQuotaInputs[op.userId] ?? ''}
                              onChange={(e) =>
                                setOpQuotaInputs((prev) => ({
                                  ...prev,
                                  [op.userId]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={savingQuotaKey === key}
                              onClick={() =>
                                void saveQuota(
                                  'operator',
                                  op.userId,
                                  opQuotaInputs[op.userId] || ''
                                )
                              }
                            >
                              ثبت
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Allowed File Policy */}
        <TabsContent value="policy">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                انواع فایل مجاز و سقف حجم بارگذاری
              </CardTitle>
              <CardDescription>
                کنترل پسوندهای مجاز (با بررسی امضای باینری واقعی فایل) و حداکثر حجم مجاز
                هر فایل
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleSavePolicy(e)} className="space-y-5">
                <div className="space-y-2">
                  <Label>پسوندهای مجاز در مخزن فایل</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    {SHARED_FILE_EXTENSION_CATALOG.map((ext) => {
                      const checked = allowedExts.includes(ext);
                      return (
                        <label
                          key={ext}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer ${
                            checked
                              ? 'border-blue-600 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAllowedExts((prev) => [...prev, ext]);
                              } else {
                                setAllowedExts((prev) => prev.filter((item) => item !== ext));
                              }
                            }}
                          />
                          <span dir="ltr" className="font-[family-name:var(--font-mono)]">
                            .{ext}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 max-w-xs">
                  <Label htmlFor="policy-max-mb">حداکثر حجم هر بارگذاری (مگابایت)</Label>
                  <Input
                    id="policy-max-mb"
                    type="number"
                    min={1}
                    max={250}
                    value={maxUploadMb}
                    onChange={(e) => setMaxUploadMb(e.target.value)}
                  />
                </div>

                <Button type="submit" disabled={savingPolicy}>
                  {savingPolicy && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>ذخیره سیاست مخزن فایل</span>
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Granular Exceptions */}
        <TabsContent value="permissions" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-700" />
                <span>ثبت استثنای دسترسی بین دپارتمانی / فردی</span>
              </CardTitle>
              <CardDescription>
                اعطای دسترسی مشخص مشاهده، دریافت، بارگذاری یا مدیریت بر فایل‌های یک
                دپارتمان به کاربر یا دپارتمان دیگر
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => void handleGrantPermission(e)}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="perm-dept">دپارتمان مبدأ فایل‌ها</Label>
                    <select
                      id="perm-dept"
                      value={permDeptId}
                      onChange={(e) => setPermDeptId(e.target.value)}
                      className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    >
                      {overview.departmentUsage.map((d) => (
                        <option key={d.departmentId} value={d.departmentId}>
                          {d.nameFa}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="perm-target-type">نوع گیرنده</Label>
                    <select
                      id="perm-target-type"
                      value={permTargetType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'user' | 'department';
                        setPermTargetType(nextType);
                        setPermTargetId(
                          nextType === 'user'
                            ? overview.operatorUsage[0]?.userId || ''
                            : overview.departmentUsage[0]?.departmentId || ''
                        );
                      }}
                      className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    >
                      <option value="user">کاربر مشخص</option>
                      <option value="department">اعضای یک دپارتمان</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="perm-target-id">هدف دسترسی</Label>
                    <select
                      id="perm-target-id"
                      value={permTargetId}
                      onChange={(e) => setPermTargetId(e.target.value)}
                      className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                    >
                      {permTargetType === 'user'
                        ? overview.operatorUsage.map((u) => (
                            <option key={u.userId} value={u.userId}>
                              {u.name} (@{u.username})
                            </option>
                          ))
                        : overview.departmentUsage.map((d) => (
                            <option key={d.departmentId} value={d.departmentId}>
                              {d.nameFa}
                            </option>
                          ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permCanView}
                      onChange={(e) => setPermCanView(e.target.checked)}
                    />
                    <span>مشاهده</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permCanDownload}
                      onChange={(e) => setPermCanDownload(e.target.checked)}
                    />
                    <span>دریافت (دانلود)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permCanUpload}
                      onChange={(e) => setPermCanUpload(e.target.checked)}
                    />
                    <span>بارگذاری</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permCanManage}
                      onChange={(e) => setPermCanManage(e.target.checked)}
                    />
                    <span>مدیریت کامل (ویرایش/حذف)</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5 flex-1 min-w-52">
                    <Label htmlFor="perm-note">توضیح مجوز (اختیاری)</Label>
                    <Input
                      id="perm-note"
                      value={permNote}
                      onChange={(e) => setPermNote(e.target.value)}
                      placeholder="دلیل اعطای این استثنای دسترسی"
                    />
                  </div>
                  <Button type="submit" disabled={savingPerm}>
                    {savingPerm ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    <span>افزودن قانون دسترسی</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">قوانین استثنای فعال</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.permissions.length === 0 ? (
                <p className="text-sm text-slate-500">
                  استثنای دسترسی خاصی ثبت نشده است (دسترسی بر اساس عضویت پیش‌فرض و سیاست
                  فایل/پوشه اعمال می‌شود).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-2.5 px-3 font-medium">دپارتمان مبدأ</th>
                        <th className="py-2.5 px-3 font-medium">گیرنده</th>
                        <th className="py-2.5 px-3 font-medium">مجوزها</th>
                        <th className="py-2.5 px-3 font-medium">یادداشت</th>
                        <th className="py-2.5 px-3 font-medium text-left">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overview.permissions.map((perm) => (
                        <tr key={perm.id}>
                          <td className="py-2.5 px-3 font-medium">
                            {perm.departmentName}
                          </td>
                          <td className="py-2.5 px-3 text-xs">{perm.targetLabel}</td>
                          <td className="py-2.5 px-3 text-xs">
                            {[
                              perm.canView ? 'مشاهده' : null,
                              perm.canDownload ? 'دانلود' : null,
                              perm.canUpload ? 'بارگذاری' : null,
                              perm.canManage ? 'مدیریت' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-500">
                            {perm.note || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-left">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-700 hover:bg-red-50"
                              onClick={() => void handleRevokePermission(perm.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: File Audit Logs */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-blue-700" />
                <span>تاریخچه ممیزی عملیات مخزن فایل</span>
              </CardTitle>
              <CardDescription>
                ثبت تمام بارگذاری‌ها، دانلودها، جایگزینی نسخه‌ها، حذف‌ها و تغییرات
                سهمیه
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {overview.recentAudit.length === 0 ? (
                <p className="text-sm text-slate-500">هنوز رویداد فایلی ثبت نشده است.</p>
              ) : (
                <table className="w-full text-sm text-right border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 px-3 font-medium">رویداد</th>
                      <th className="py-2.5 px-3 font-medium">کاربر</th>
                      <th className="py-2.5 px-3 font-medium">جزئیات</th>
                      <th className="py-2.5 px-3 font-medium">زمان (شمسی)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview.recentAudit.map((row) => (
                      <tr key={row.id}>
                        <td
                          dir="ltr"
                          className="py-2.5 px-3 text-xs font-[family-name:var(--font-mono)] text-slate-800 text-right"
                        >
                          {row.action}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700">
                          {row.actorName
                            ? `${row.actorName} (@${row.actorUsername})`
                            : 'سیستم'}
                        </td>
                        <td
                          dir="ltr"
                          className="py-2.5 px-3 text-[11px] font-[family-name:var(--font-mono)] text-slate-600 text-right max-w-md truncate"
                        >
                          {row.metadata ? JSON.stringify(row.metadata) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatJalaliDateTime(row.createdAt)}
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
