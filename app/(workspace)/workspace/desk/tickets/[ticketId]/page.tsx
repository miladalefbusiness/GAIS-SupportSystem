import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  TicketDetailWorkspace,
  type OperatorTicketDetailPayload,
} from '@/components/workspace/TicketDetailWorkspace';
import { getCurrentSession } from '@/src/core/auth/auth.ts';
import { hasPermission } from '@/src/core/auth/rbac.ts';
import { getOperatorTicketDetail } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export default async function OperatorTicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  if (!hasPermission(session.access, 'desk:workspace:access')) {
    return (
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">عدم دسترسی به میز پشتیبانی (۴۰۳)</CardTitle>
          </div>
          <CardDescription className="text-red-700">
            حساب کاربری شما مجوز دسترسی به فضای میز پشتیبانی را ندارد.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { ticketId } = await params;

  let detail: OperatorTicketDetailPayload | null = null;
  try {
    detail = (await getOperatorTicketDetail(
      session.access,
      ticketId
    )) as OperatorTicketDetailPayload | null;
  } catch (err) {
    if (err instanceof Error && err.message === 'DEPARTMENT_ACCESS_DENIED') {
      return (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader>
            <div className="flex items-center gap-2 text-red-800">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle className="text-base">
                دسترسی غیرمجاز به تیکت دپارتمان دیگر (۴۰۳)
              </CardTitle>
            </div>
            <CardDescription className="text-red-700 leading-relaxed">
              این تیکت متعلق به دپارتمانی است که شما عضو مجاز آن نیستید. کنترل دسترسی دپارتمانی در سرور اعمال می‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/workspace/desk">بازگشت به دپارتمان‌های مجاز</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }
    throw err;
  }

  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">تیکت یافت نشد</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/workspace/desk">بازگشت به میز پشتیبانی</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <TicketDetailWorkspace
      initialDetail={detail}
      canReply={hasPermission(session.access, 'desk:tickets:reply')}
      canInternalNotes={hasPermission(session.access, 'desk:tickets:internal_notes')}
      canAssign={hasPermission(session.access, 'desk:tickets:assign')}
    />
  );
}
