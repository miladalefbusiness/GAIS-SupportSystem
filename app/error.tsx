'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void error;
  }, [error]);

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12"
    >
      <Card className="w-full max-w-md border-red-200">
        <CardHeader>
          <div className="flex items-center gap-2.5 text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <CardTitle className="text-base">
              خطای غیرمنتظره در پردازش صفحه
            </CardTitle>
          </div>
          <CardDescription>
            خطایی در اجرای درخواست رخ داد. اطلاعات فنی محرمانه در سمت سرور ثبت
            شده و برای حفظ امنیت نمایش داده نمی‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2.5">
          <Button type="button" onClick={() => reset()} size="sm">
            <RefreshCw className="h-4 w-4" />
            <span>تلاش مجدد</span>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/">بازگشت به صفحه اصلی</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
