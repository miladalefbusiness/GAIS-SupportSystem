import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { db } from '@/src/db/index.ts';
import { aiConversations, customerProfiles } from '@/src/db/schema.ts';
import { handoffConversationToHuman } from '@/src/modules/ai/chat.ts';
import { handoffConversationSchema } from '@/src/modules/ai/schemas.ts';
import {
  getAuthenticatedCustomerSession,
  resolveOrCreateCustomerByIdentity,
} from '@/src/modules/customers/service.ts';
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

    const customerSession = await getAuthenticatedCustomerSession();
    let resolvedCustomer: { id: string; fullName: string } | null = customerSession
      ? { id: customerSession.customer.id, fullName: customerSession.customer.fullName }
      : null;

    if (!resolvedCustomer && parsed.data.nationalId && parsed.data.fullName) {
      const identity = await resolveOrCreateCustomerByIdentity({
        nationalId: parsed.data.nationalId,
        fullName: parsed.data.fullName,
      });
      resolvedCustomer = { id: identity.id, fullName: identity.fullName };
    }

    if (!resolvedCustomer) {
      const existingConv = await db.query.aiConversations.findFirst({
        where: eq(aiConversations.id, id),
      });
      if (existingConv?.customerProfileId) {
        const profile = await db.query.customerProfiles.findFirst({
          where: eq(customerProfiles.id, existingConv.customerProfileId),
        });
        if (profile) {
          resolvedCustomer = { id: profile.id, fullName: profile.fullName };
        }
      }
    }

    if (resolvedCustomer) {
      await db
        .update(aiConversations)
        .set({ customerProfileId: resolvedCustomer.id, updatedAt: new Date() })
        .where(eq(aiConversations.id, id));
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

    let convertedTicketSummary: {
      id: string;
      referenceCode: string;
      subject: string;
      status: string;
      departmentNameFa: string;
    } | null = null;

    if (resolvedCustomer) {
      try {
        const conversion = await convertAiConversationToTicket({
          customerId: resolvedCustomer.id,
          customerName: resolvedCustomer.fullName,
          aiConversationId: id,
          subject: parsed.data.subject,
          reason: parsed.data.reason,
          ipAddress,
          userAgent,
        });
        if (conversion.ticket) {
          convertedTicketSummary = {
            id: conversion.ticket.id,
            referenceCode: conversion.ticket.referenceCode,
            subject: conversion.ticket.subject,
            status: conversion.ticket.status,
            departmentNameFa: conversion.ticket.departmentNameFa,
          };
        }
      } catch {
        // Keep handoff state even if ticket link skipped
      }
    }

    return NextResponse.json({
      ...result,
      requiresCustomerVerification: !resolvedCustomer,
      requiresPortalLoginForTracking: !customerSession,
      ticket: convertedTicketSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('INVALID_NATIONAL_ID:')) {
      return NextResponse.json(
        { error: message.slice('INVALID_NATIONAL_ID:'.length) },
        { status: 400 }
      );
    }
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
