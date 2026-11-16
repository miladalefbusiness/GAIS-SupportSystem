'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
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
  purpose = 'customer_portal',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (customer: VerifiedCustomerDto) => void;
  purpose?: 'customer_portal' | 'ticket_create' | 'ticket_handoff';
}) {
  const [step, setStep] = useState<'identity' | 'otp'>('identity');
  const [nationalId, setNationalId] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [devPreviewCode, setDevPreviewCode] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setStep('identity');
    setChallengeId('');
    setOtpCode('');
    setDevPreviewCode(undefined);
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/customer/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nationalId,
          fullName,
          phone: phone.trim() || undefined,
          purpose,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'خطا در ارسال کد تأیید.');
        return;
      }

      setChallengeId(data.challengeId);
      setDevPreviewCode(data.devPreviewCode);
      setStep('otp');
      toast.success('کد تأیید یک‌بارمصرف صادر شد.');
    } catch {
      toast.error('خطای شبکه در ارتباط با سرور.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/customer/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          otpCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'کد تأیید معتبر نیست.');
        return;
      }

      toast.success('هویت شما با موفقیت تأیید شد.');
      resetForm();
      onVerified(data.customer);
      onOpenChange(false);
    } catch {
      toast.error('خطای شبکه در بررسی کد تأیید.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-blue-700">
            <ShieldCheck className="h-5 w-5" />
            <DialogTitle className="text-base text-slate-900">
              احراز هویت سریع مشتری (کد ملی)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-relaxed">
            برای ثبت تیکت پشتیبانی، ادامه گفت‌وگو با اپراتور و مشاهده سوابق تیکت‌ها، نیازی به ساخت رمز عبور ندارید؛ کافی است کد ملی و نام خود را با کد یک‌بارمصرف تأیید کنید.
          </DialogDescription>
        </DialogHeader>

        {step === 'identity' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4 pt-2">
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

            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex items-start gap-2">
              <LockKeyhole className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
              <span>
                کد ملی شما به صورت رمزنگاری‌شده نگهداری می‌شود و در پنل‌های عمومی یا نشانی‌های وب نمایش داده نمی‌شود.
              </span>
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>ارسال کد تأیید یک‌بارمصرف</span>
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4 pt-2">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
              <p className="font-medium">کد تأیید ۶ رقمی برای {fullName} صادر شد.</p>
              {devPreviewCode && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-blue-800">
                  <span>
                    پیش‌نمایش محیط توسعه:{' '}
                    <strong className="font-[family-name:var(--font-mono)] tracking-wider">
                      {devPreviewCode}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOtpCode(devPreviewCode)}
                    className="font-semibold underline cursor-pointer"
                  >
                    درج خودکار
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cust-otp">کد تأیید پیامکی</Label>
              <Input
                id="cust-otp"
                dir="ltr"
                inputMode="numeric"
                placeholder="123456"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                required
                className="font-[family-name:var(--font-mono)] text-center text-base tracking-widest"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={submitting}
              >
                بازگشت
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>تأیید و ورود به پورتال تیکت</span>
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
