import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function NotFound() {
  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2.5 text-slate-800">
            <FileQuestion className="h-5 w-5 text-blue-700 shrink-0" />
            <CardTitle className="text-base">صفحه مورد نظر یافت نشد (۴۰۴)</CardTitle>
          </div>
          <CardDescription>
            نشانی واردشده وجود ندارد یا ممکن است دسترسی به آن تغییر کرده باشد.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2.5">
          <Button asChild size="sm">
            <Link href="/">پورتال عمومی پشتیبانی</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/workspace">میز کار سازمانی</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
