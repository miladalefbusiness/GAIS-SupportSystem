'use client';

import { useState } from 'react';
import { CheckCircle2, Globe, Loader2, Palette, Save, ShieldCheck } from 'lucide-react';
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
import { formatJalaliDateTime } from '@/src/lib/jalali';
import {
  THEME_ACCENT_OPTIONS,
  type PlatformSettingsDto,
  type ThemeAccentPreset,
} from '@/src/modules/admin/settings-schema';

const ACCENT_LABELS: Record<ThemeAccentPreset, string> = {
  blue: 'آبی سازمانی (پیش‌فرض)',
  indigo: 'نیلی مدرن',
  emerald: 'سبز زمردی',
  slate: 'خاکستری کلاسیک',
};

export function SystemSettingsManager({
  initialSettings,
  initialUpdatedAt,
}: {
  initialSettings: PlatformSettingsDto;
  initialUpdatedAt: string | null;
}) {
  const [form, setForm] = useState<PlatformSettingsDto>(initialSettings);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در ذخیره تنظیمات عمومی.');
        return;
      }
      setForm(json.settings);
      setUpdatedAt(json.updatedAt);
      toast.success('تنظیمات عمومی سامانه با موفقیت ذخیره و اعمال شد.');
    } catch {
      toast.error('خطای شبکه در ذخیره تنظیمات.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">تنظیمات عمومی و ظاهری سامانه</h1>
          <p className="text-sm text-slate-600">
            پیکربندی هویت بصری پورتال عمومی، متن‌های خوش‌آمدگویی، اطلاعیه سراسری و سیاست
            پیش‌فرض تیکت‌ها
          </p>
        </div>
        {updatedAt && (
          <div className="text-xs text-slate-500 flex items-center gap-1.5 tabular-nums">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            <span>آخرین بروزرسانی: {formatJalaliDateTime(updatedAt)}</span>
          </div>
        )}
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-700" />
              <span>هویت پورتال و محتوای صفحه اصلی</span>
            </CardTitle>
            <CardDescription>
              تغییرات این بخش بلافاصله در پورتال عمومی و نوار بالای پنل کاربری نمایش داده
              می‌شوند.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sys-brand-name">نام کوتاه برند در نوار بالا</Label>
                <Input
                  id="sys-brand-name"
                  required
                  value={form.brandNameFa}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, brandNameFa: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sys-site-title">عنوان کامل سامانه</Label>
                <Input
                  id="sys-site-title"
                  required
                  value={form.siteTitleFa}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, siteTitleFa: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sys-hero-title">تیتر اصلی پورتال عمومی</Label>
              <Input
                id="sys-hero-title"
                required
                value={form.heroTitleFa}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, heroTitleFa: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sys-hero-desc">توضیحات راهنمای مشتریان در صفحه اصلی</Label>
              <textarea
                id="sys-hero-desc"
                rows={3}
                required
                value={form.heroDescriptionFa}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, heroDescriptionFa: e.target.value }))
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sys-contact">متن ساعات پاسخگویی / تماس پشتیبانی</Label>
                <Input
                  id="sys-contact"
                  value={form.supportContactText}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, supportContactText: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sys-notice">اطلاعیه سراسری پورتال (اختیاری)</Label>
                <Input
                  id="sys-notice"
                  value={form.maintenanceNoticeFa}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, maintenanceNoticeFa: e.target.value }))
                  }
                  placeholder="در صورت تکمیل، به صورت بنر در بالای صفحه عمومی نمایش داده می‌شود"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-blue-700" />
                <span>تنظیمات ظاهری پورتال</span>
              </CardTitle>
              <CardDescription>انتخاب تم رنگی و نمایش بخش‌ها در پورتال</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sys-accent">رنگ تاکیدی سامانه</Label>
                <select
                  id="sys-accent"
                  value={form.themeAccent}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      themeAccent: e.target.value as ThemeAccentPreset,
                    }))
                  }
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  {THEME_ACCENT_OPTIONS.map((preset) => (
                    <option key={preset} value={preset}>
                      {ACCENT_LABELS[preset]}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.showWorkspacesSummary}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      showWorkspacesSummary: e.target.checked,
                    }))
                  }
                />
                <span>نمایش معرفی فضاهای کاری چهارگانه در صفحه عمومی</span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-700" />
                <span>تنظیمات عملیاتی و امنیتی پایه</span>
              </CardTitle>
              <CardDescription>پارامترهای پیش‌فرض تیکتینگ و کد تأیید مشتری</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sys-default-priority">اولویت پیش‌فرض تیکت‌های جدید</Label>
                <select
                  id="sys-default-priority"
                  value={form.defaultTicketPriority}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultTicketPriority: e.target.value as
                        | 'low'
                        | 'normal'
                        | 'high'
                        | 'urgent',
                    }))
                  }
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="low">کم</option>
                  <option value="normal">عادی (پیش‌فرض)</option>
                  <option value="high">بالا</option>
                  <option value="urgent">فوری</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sys-otp-ttl">مدت اعتبار کد یک‌بارمصرف مشتری (دقیقه)</Label>
                <Input
                  id="sys-otp-ttl"
                  type="number"
                  min={2}
                  max={30}
                  value={form.customerOtpTtlMinutes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      customerOtpTtlMinutes: Number(e.target.value) || 5,
                    }))
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>ذخیره و اعمال تنظیمات سامانه</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
