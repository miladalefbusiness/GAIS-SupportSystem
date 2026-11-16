import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { assignTicketSchema } from '@/src/modules/tickets/schemas.ts';
import { reassignTicketOperator } from '@/src/modules/tickets/service.ts';

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
    const parsed = assignTicketSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات تخصیص نامعتبر است.' },
        { status: 400 }
      );
    }

    const detail = await reassignTicketOperator({
      access: guard.session.access,
      actorName: guard.session.user.name,
      ticketId: id,
      operatorId: parsed.data.operatorId,
      reason: parsed.data.reason,
      ipAddress,
      userAgent,
    });

    if (!detail) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در تخصیص تیکت به اپراتور.');
  }
}
