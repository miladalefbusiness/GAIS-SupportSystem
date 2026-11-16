import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { transferTicketSchema } from '@/src/modules/tickets/schemas.ts';
import { transferTicketDepartment } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('desk:tickets:assign');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = transferTicketSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات انتقال نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await transferTicketDepartment({
      access: guard.session.access,
      actorName: guard.session.user.name,
      ticketId: id,
      targetDepartmentId: parsed.data.targetDepartmentId,
      operatorId: parsed.data.operatorId,
      reason: parsed.data.reason,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در انتقال تیکت به دپارتمان مقصد.');
  }
}
