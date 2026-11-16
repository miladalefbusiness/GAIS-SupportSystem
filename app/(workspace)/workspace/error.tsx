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

export default function WorkspaceError({
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
    <Card className="border-red-200 bg-red-50/30">
      <CardHeader>
        <div className="flex items-center gap-2 text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <CardTitle className="text-base">خطا در بارگذاری بخش میز کار</CardTitle>
        </div>
        <CardDescription className="text-red-700">
          در هنگام دریافت اطلاعات از سرور مشکلی پیش آمد. لطفاً دوباره تلاش کنید.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => reset()}>
          <RefreshCw className="h-4 w-4" />
          <span>بارگذاری مجدد</span>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/workspace">بازگشت به نمای کلی</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
