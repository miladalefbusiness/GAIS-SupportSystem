import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { operatorReplySchema } from '@/src/modules/tickets/schemas.ts';
import {
  addOperatorTicketMessage,
  type UploadedFileInput,
} from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission([
    'desk:tickets:reply',
    'desk:tickets:internal_notes',
  ]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const contentType = req.headers.get('content-type') || '';
    let rawBody = '';
    let rawVisibility: string = 'public';
    const files: UploadedFileInput[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      rawBody = String(formData.get('body') ?? '');
      rawVisibility = String(formData.get('visibility') ?? 'public');
      for (const entry of formData.getAll('files')) {
        if (entry instanceof File && entry.size > 0) {
          const arr = await entry.arrayBuffer();
          files.push({ filename: entry.name, buffer: Buffer.from(arr) });
        }
      }
    } else {
      const body = await req.json();
      rawBody = typeof body?.body === 'string' ? body.body : '';
      rawVisibility =
        typeof body?.visibility === 'string' ? body.visibility : 'public';
    }

    const parsed = operatorReplySchema.safeParse({
      body: rawBody,
      visibility: rawVisibility,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات پیام نامعتبر است.' },
        { status: 400 }
      );
    }

    const detail = await addOperatorTicketMessage({
      access: guard.session.access,
      actorName: guard.session.user.name,
      ticketId: id,
      body: parsed.data.body,
      visibility: parsed.data.visibility,
      files,
      ipAddress,
      userAgent,
    });

    if (!detail) {
      return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در ثبت پیام یا یادداشت داخلی.');
  }
}
