import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { customerReplySchema } from '@/src/modules/tickets/schemas.ts';
import {
  addCustomerTicketMessage,
  type UploadedFileInput,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'احراز هویت مشتری انجام نشده است.' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const contentType = req.headers.get('content-type') || '';
    let rawBody = '';
    const files: UploadedFileInput[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      rawBody = String(formData.get('body') ?? '');
      for (const entry of formData.getAll('files')) {
        if (entry instanceof File && entry.size > 0) {
          const arr = await entry.arrayBuffer();
          files.push({ filename: entry.name, buffer: Buffer.from(arr) });
        }
      }
    } else {
      const body = await req.json();
      rawBody = typeof body?.body === 'string' ? body.body : '';
    }

    const parsed = customerReplySchema.safeParse({ body: rawBody });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'متن پیام نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await addCustomerTicketMessage({
      customerId: session.customer.id,
      customerName: session.customer.fullName,
      ticketId: id,
      body: parsed.data.body,
      files,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    logger.warn('public.tickets.reply_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return mapTicketDomainError(error, 'خطا در ارسال پیام.');
  }
}
