import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { updateTicketMetaSchema } from '@/src/modules/tickets/schemas.ts';
import {
  getOperatorTicketDetail,
  updateTicketMeta,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('desk:workspace:access');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  try {
    const detail = await getOperatorTicketDetail(guard.session.access, id);
    if (!detail) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در دریافت جزئیات تیکت.');
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('desk:tickets:reply');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateTicketMetaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات به‌روزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await updateTicketMeta({
      access: guard.session.access,
      actorName: guard.session.user.name,
      ticketId: id,
      status: parsed.data.status,
      priority: parsed.data.priority,
      aiAutoReplyEnabled: parsed.data.aiAutoReplyEnabled,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در به‌روزرسانی وضعیت تیکت.');
  }
}
