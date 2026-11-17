import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getPlatformSettings } from '@/src/modules/admin/settings.ts';
import {
  getAuthenticatedCustomerSession,
  resolveOrCreateCustomerByIdentity,
} from '@/src/modules/customers/service.ts';
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
      { error: 'برای مشاهده تیکت‌ها ابتدا با کد ملی و رمز عبور وارد شوید.' },
      { status: 401 }
    );
  }

  const items = await listCustomerTickets(session.customer.id);
  return NextResponse.json({ tickets: items });
}

export async function POST(req: NextRequest) {
  const session = await getAuthenticatedCustomerSession();
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const contentType = req.headers.get('content-type') || '';
    const { settings: platformSettings } = await getPlatformSettings();

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const rawNationalId = formData.get('nationalId');
      const rawFullName = formData.get('fullName');
      const rawPayload = {
        departmentId: String(formData.get('departmentId') ?? ''),
        subject: String(formData.get('subject') ?? ''),
        description: String(formData.get('description') ?? ''),
        priority: formData.get('priority')
          ? String(formData.get('priority'))
          : platformSettings.defaultTicketPriority,
        nationalId:
          typeof rawNationalId === 'string' && rawNationalId.trim()
            ? rawNationalId.trim()
            : undefined,
        fullName:
          typeof rawFullName === 'string' && rawFullName.trim()
            ? rawFullName.trim()
            : undefined,
      };

      const parsed = createCustomerTicketSchema.safeParse(rawPayload);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || 'اطلاعات تیکت نامعتبر است.' },
          { status: 400 }
        );
      }

      let customerId = session?.customer.id ?? null;
      let customerName = session?.customer.fullName ?? null;
      if (!customerId) {
        if (!parsed.data.nationalId || !parsed.data.fullName) {
          return NextResponse.json(
            {
              error:
                'برای ثبت تیکت، وارد کردن کد ملی و نام و نام خانوادگی الزامی است.',
            },
            { status: 400 }
          );
        }
        const resolved = await resolveOrCreateCustomerByIdentity({
          nationalId: parsed.data.nationalId,
          fullName: parsed.data.fullName,
        });
        customerId = resolved.id;
        customerName = resolved.fullName;
      }

      const files: UploadedFileInput[] = [];
      for (const entry of formData.getAll('files')) {
        if (entry instanceof File && entry.size > 0) {
          const arr = await entry.arrayBuffer();
          files.push({ filename: entry.name, buffer: Buffer.from(arr) });
        }
      }

      const ticket = await createCustomerTicket({
        customerId,
        customerName: customerName!,
        departmentId: parsed.data.departmentId,
        subject: parsed.data.subject,
        description: parsed.data.description,
        priority: parsed.data.priority,
        files,
        ipAddress,
        userAgent,
      });

      return NextResponse.json(
        {
          ticket: session
            ? ticket
            : ticket
            ? {
                id: ticket.id,
                referenceCode: ticket.referenceCode,
                subject: ticket.subject,
                departmentNameFa: ticket.departmentNameFa,
                status: ticket.status,
                createdAt: ticket.createdAt,
              }
            : null,
          requiresPortalLoginForTracking: !session,
        },
        { status: 201 }
      );
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
      if (!session) {
        return NextResponse.json(
          { error: 'برای مشاهده تیکت یا تکمیل ارجاع ابتدا با کد ملی و رمز عبور وارد شوید.' },
          { status: 401 }
        );
      }

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

    let customerId = session?.customer.id ?? null;
    let customerName = session?.customer.fullName ?? null;
    if (!customerId) {
      if (!parsed.data.nationalId || !parsed.data.fullName) {
        return NextResponse.json(
          {
            error:
              'برای ثبت تیکت، وارد کردن کد ملی و نام و نام خانوادگی الزامی است.',
          },
          { status: 400 }
        );
      }
      const resolved = await resolveOrCreateCustomerByIdentity({
        nationalId: parsed.data.nationalId,
        fullName: parsed.data.fullName,
      });
      customerId = resolved.id;
      customerName = resolved.fullName;
    }

    const ticket = await createCustomerTicket({
      customerId,
      customerName: customerName!,
      departmentId: parsed.data.departmentId,
      subject: parsed.data.subject,
      description: parsed.data.description,
      priority: parsed.data.priority,
      ipAddress,
      userAgent,
    });

    return NextResponse.json(
      {
        ticket: session
          ? ticket
          : ticket
          ? {
              id: ticket.id,
              referenceCode: ticket.referenceCode,
              subject: ticket.subject,
              departmentNameFa: ticket.departmentNameFa,
              status: ticket.status,
              createdAt: ticket.createdAt,
            }
          : null,
        requiresPortalLoginForTracking: !session,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('INVALID_NATIONAL_ID:')) {
      return NextResponse.json(
        { error: message.slice('INVALID_NATIONAL_ID:'.length) },
        { status: 400 }
      );
    }
    logger.warn('public.tickets.create_failed', { error: message || 'unknown' });
    return mapTicketDomainError(error, 'خطا در ثبت تیکت پشتیبانی.');
  }
}
