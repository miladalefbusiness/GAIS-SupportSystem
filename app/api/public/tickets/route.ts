import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import {
  convertAiConversationSchema,
  createCustomerTicketSchema,
} from '@/src/modules/tickets/schemas.ts';
import {
  convertAiConversationToTicket,
  createCustomerTicket,
  listCustomerTickets,
  type UploadedFileInput,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'برای مشاهده تیکت‌ها ابتدا کد ملی و هویت خود را تأیید کنید.' },
      { status: 401 }
    );
  }

  const items = await listCustomerTickets(session.customer.id);
  return NextResponse.json({ tickets: items });
}

export async function POST(req: NextRequest) {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'برای ثبت تیکت ابتدا باید احراز هویت مشتری را تکمیل کنید.' },
      { status: 401 }
    );
  }

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const contentType = req.headers.get('content-type') || '';
    const { settings: platformSettings } = await getPlatformSettings();

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const rawPayload = {
        departmentId: String(formData.get('departmentId') ?? ''),
        subject: String(formData.get('subject') ?? ''),
        description: String(formData.get('description') ?? ''),
        priority: formData.get('priority')
          ? String(formData.get('priority'))
          : platformSettings.defaultTicketPriority,
      };

      const parsed = createCustomerTicketSchema.safeParse(rawPayload);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'اطلاعات تیکت نامعتبر است.' },
          { status: 400 }
        );
      }

      const files: UploadedFileInput[] = [];
      for (const entry of formData.getAll('files')) {
        if (entry instanceof File && entry.size > 0) {
          const arr = await entry.arrayBuffer();
          files.push({ filename: entry.name, buffer: Buffer.from(arr) });
        }
      }

      const ticket = await createCustomerTicket({
        customerId: session.customer.id,
        customerName: session.customer.fullName,
        departmentId: parsed.data.departmentId,
        subject: parsed.data.subject,
        description: parsed.data.description,
        priority: parsed.data.priority,
        files,
        ipAddress,
        userAgent,
      });

      return NextResponse.json({ ticket }, { status: 201 });
    }

    const body = await req.json();
    const bodyWithDefaultPriority =
      body && typeof body === 'object' && !('priority' in body && body.priority)
        ? { ...body, priority: platformSettings.defaultTicketPriority }
        : body;

    if (
      bodyWithDefaultPriority &&
      typeof bodyWithDefaultPriority === 'object' &&
      'aiConversationId' in bodyWithDefaultPriority &&
      bodyWithDefaultPriority.aiConversationId
    ) {
      const parsedHandoff = convertAiConversationSchema.safeParse(bodyWithDefaultPriority);
      if (!parsedHandoff.success) {
        return NextResponse.json(
          { error: parsedHandoff.error.issues[0]?.message || 'اطلاعات ارجاع نامعتبر است.' },
          { status: 400 }
        );
      }

      const result = await convertAiConversationToTicket({
        customerId: session.customer.id,
        customerName: session.customer.fullName,
        aiConversationId: parsedHandoff.data.aiConversationId,
        subject: parsedHandoff.data.subject,
        priority: parsedHandoff.data.priority,
        reason: parsedHandoff.data.reason,
        ipAddress,
        userAgent,
      });

      return NextResponse.json(result, { status: result.alreadyConverted ? 200 : 201 });
    }

    const parsed = createCustomerTicketSchema.safeParse(bodyWithDefaultPriority);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات تیکت نامعتبر است.' },
        { status: 400 }
      );
    }

    const ticket = await createCustomerTicket({
      customerId: session.customer.id,
      customerName: session.customer.fullName,
      departmentId: parsed.data.departmentId,
      subject: parsed.data.subject,
      description: parsed.data.description,
      priority: parsed.data.priority,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    logger.warn('public.tickets.create_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return mapTicketDomainError(error, 'خطا در ثبت تیکت پشتیبانی.');
  }
}
