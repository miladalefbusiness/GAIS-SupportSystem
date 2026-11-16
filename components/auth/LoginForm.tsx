'use client';

import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { Eye, EyeOff, Headset, KeyRound, Loader2, LogIn } from 'lucide-react';
import Link from 'next/link';
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
import { firebaseAuth, googleAuthProvider } from '@/src/lib/firebase';

export function LoginForm({
  brandNameFa = 'پورتال پشتیبانی سازمانی',
}: {
  brandNameFa?: string;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCredentialSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setLoadingCreds(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'خطا در ورود به سامانه.');
        return;
      }

      toast.success('ورود با موفقیت انجام شد.');
      const target = data.mustChangePassword ? '/change-password' : '/workspace';
      window.location.assign(target);
      return;
    } catch {
      setErrorMessage('ارتباط با سرور برقرار نشد.');
    } finally {
      setLoadingCreds(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setLoadingGoogle(true);

    try {
      const credential = await signInWithPopup(firebaseAuth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();

      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'ورود با حساب گوگل ناموفق بود.');
        return;
      }

      toast.success('احراز هویت گوگل تایید شد.');
      const target = data.mustChangePassword ? '/change-password' : '/workspace';
      window.location.assign(target);
      return;
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed')
          ? 'پنجره ورود گوگل بسته شد.'
          : 'خطا در احراز هویت گوگل. لطفاً دوباره تلاش کنید.';
      setErrorMessage(msg);
    } finally {
      setLoadingGoogle(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
            <Headset className="h-4 w-4" />
            <span>{brandNameFa}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            ورود به پنل همکاران و مدیریت
          </h1>
          <p className="text-sm text-slate-600">
            دسترسی اختصاصی اپراتورهای پشتیبانی و مدیران سامانه
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">احراز هویت سازمانی</CardTitle>
            <CardDescription>
              با نام کاربری و رمز عبور سازمانی یا حساب گوگل متصل‌شده وارد شوید.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
              >
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleCredentialSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">نام کاربری یا ایمیل سازمانی</Label>
                <Input
                  id="identifier"
                  name="identifier"
                  dir="ltr"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">رمز عبور</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loadingCreds || loadingGoogle}
              >
                {loadingCreds ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                <span>ورود با نام کاربری</span>
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-slate-500">یا</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={loadingCreds || loadingGoogle}
            >
              {loadingGoogle ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              <span>ورود با حساب گوگل</span>
            </Button>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link
            href="/"
            className="text-xs font-medium text-slate-600 hover:text-blue-700 transition-colors"
          >
            بازگشت به پورتال پشتیبانی مشتریان
          </Link>
        </div>
      </div>
    </div>
  );
}
