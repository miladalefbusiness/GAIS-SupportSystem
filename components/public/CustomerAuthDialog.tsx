'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface VerifiedCustomerDto {
  id: string;
  customerRef: string;
  fullName: string;
  phoneMasked: string | null;
  createdAt: string;
}

export function CustomerAuthDialog({
  open,
  onOpenChange,
  onVerified,
  initialNationalId = '',
  initialFullName = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (customer: VerifiedCustomerDto) => void;
  initialNationalId?: string;
  initialFullName?: string;
}) {
  const [mode, setMode] = useState<'login' | 'set_password'>('login');
  const [nationalId, setNationalId] = useState(initialNationalId);
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetSensitiveFields() {
    setPassword('');
    setConfirmPassword('');
    setNotice(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (mode === 'set_password' && password !== confirmPassword) {
      toast.error('رمز عبور و تکرار آن یکسان نیستند.');
      return;
    }

    setSubmitting(true);
    setNotice(null);

    try {
      const res = await fetch('/api/public/customer/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nationalId: nationalId.trim(),
          password,
          fullName: mode === 'set_password' ? fullName.trim() : undefined,
          phone: mode === 'set_password' && phone.trim() ? phone.trim() : undefined,
          mode,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'NEEDS_FIRST_TIME_PASSWORD') {
          setMode('set_password');
          setNotice(
            'برای این کد ملی هنوز رمز عبوری تعیین نشده است. نام خود را وارد کرده و برای اولین بار رمز عبور تنظیم کنید.'
          );
          toast.info('لطفاً رمز عبور بار اول خود را ثبت کنید.');
          return;
        }
        if (data.code === 'PASSWORD_ALREADY_SET') {
          setMode('login');
          setNotice(
            'برای این کد ملی قبلاً رمز عبور ثبت شده است. با رمز عبور خود وارد شوید یا در صورت فراموشی از مدیر سامانه بخواهید رمز را بازنشانی کند.'
          );
        }
        toast.error(data.error || 'خطا در ورود به پورتال تیکت‌ها.');
        return;
      }

      toast.success(
        data.isFirstTimeSetup
          ? 'رمز عبور شما ثبت شد و وارد پورتال تیکت‌ها شدید.'
          : 'ورود به پورتال تیکت‌ها با موفقیت انجام شد.'
      );
      resetSensitiveFields();
      onVerified(data.customer);
      onOpenChange(false);
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          if (initialNationalId && !nationalId) setNationalId(initialNationalId);
          if (initialFullName && !fullName) setFullName(initialFullName);
        } else {
          resetSensitiveFields();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-blue-700">
            <ShieldCheck className="h-5 w-5" />
            <DialogTitle className="text-base text-slate-900">
              تأیید هویت و مشاهده تیکت‌ها
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-relaxed">
            برای مشاهده پاسخ کارشناسان و پیگیری تیکت‌های ثبت‌شده با کد ملی خود، با کد ملی و رمز عبور وارد شوید. اگر بار اول است، رمز عبور خود را تنظیم کنید.
          </DialogDescription>
        </DialogHeader>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setNotice(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>ورود با رمز عبور</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('set_password');
              setNotice(null);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
              mode === 'set_password'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>ثبت رمز عبور (بار اول)</span>
          </button>
        </div>

        {notice && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 leading-relaxed">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="cust-nid">کد ملی (۱۰ رقم)</Label>
            <Input
              id="cust-nid"
              dir="ltr"
              inputMode="numeric"
              placeholder="0012345679"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              required
              className="font-[family-name:var(--font-mono)] text-right"
            />
          </div>

          {mode === 'set_password' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cust-name">نام و نام خانوادگی</Label>
                <Input
                  id="cust-name"
                  placeholder="مثال: سارا محمدی"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-phone">شماره همراه (اختیاری)</Label>
                <Input
                  id="cust-phone"
                  dir="ltr"
                  inputMode="tel"
                  placeholder="09123456789"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="font-[family-name:var(--font-mono)] text-right"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cust-password">
              {mode === 'set_password' ? 'رمز عبور دلخواه (حداقل ۶ کاراکتر)' : 'رمز عبور'}
            </Label>
            <Input
              id="cust-password"
              type="password"
              dir="ltr"
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              className="font-[family-name:var(--font-mono)] text-right"
            />
          </div>

          {mode === 'set_password' && (
            <div className="space-y-1.5">
              <Label htmlFor="cust-confirm-password">تکرار رمز عبور</Label>
              <Input
                id="cust-confirm-password"
                type="password"
                dir="ltr"
                placeholder="••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
                className="font-[family-name:var(--font-mono)] text-right"
              />
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex items-start gap-2 leading-relaxed">
            <LockKeyhole className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
            <span>
              در صورت فراموشی رمز عبور، می‌توانید از پشتیبانی یا مدیر ارشد سامانه درخواست بازنشانی رمز برای کد ملی خود نمایید.
            </span>
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>
              {mode === 'set_password'
                ? 'ثبت رمز عبور و مشاهده تیکت‌ها'
                : 'ورود و مشاهده تیکت‌ها'}
            </span>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
