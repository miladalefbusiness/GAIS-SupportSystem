import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { handoffConversationToHuman } from '@/src/modules/ai/chat.ts';
import { handoffConversationSchema } from '@/src/modules/ai/schemas.ts';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { convertAiConversationToTicket } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = handoffConversationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات درخواست ارجاع نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await handoffConversationToHuman({
      conversationId: id,
      departmentId: parsed.data.departmentId,
      reason: parsed.data.reason,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'گفت‌وگو یافت نشد.' },
        { status: 404 }
      );
    }

    const customerSession = await getAuthenticatedCustomerSession();
    let convertedTicket = null;
    if (customerSession) {
      try {
        const conversion = await convertAiConversationToTicket({
          customerId: customerSession.customer.id,
          customerName: customerSession.customer.fullName,
          aiConversationId: id,
          reason: parsed.data.reason,
          ipAddress,
          userAgent,
        });
        convertedTicket = conversion.ticket;
      } catch {
        // Keep handoff state even if ticket link skipped
      }
    }

    return NextResponse.json({
      ...result,
      requiresCustomerVerification: !customerSession,
      ticket: convertedTicket,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'CONVERSATION_DEPARTMENT_MISMATCH') {
      return NextResponse.json(
        { error: 'این گفت‌وگو متعلق به دپارتمان انتخاب‌شده نیست.' },
        { status: 400 }
      );
    }

    logger.error('public.ai.handoff_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ثبت درخواست ارتباط با اپراتور.' },
      { status: 500 }
    );
  }
}

