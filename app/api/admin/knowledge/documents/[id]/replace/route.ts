import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { replaceKnowledgeDocumentFile } from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'انتخاب فایل جدید الزامی است.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const result = await replaceKnowledgeDocumentFile({
      documentId: id,
      filename: fileEntry.name,
      buffer,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json({ error: 'سند یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ document: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REPLACE_FAILED';
    const messageMap: Record<string, string> = {
      EMPTY_FILE: 'فایل انتخاب‌شده خالی است.',
      FILE_TOO_LARGE: 'حجم فایل بیشتر از ۲۵ مگابایت است.',
      UNSUPPORTED_FILE_TYPE: 'فرمت فایل مجاز نیست (PDF، DOCX، TXT، Markdown).',
      INVALID_FILE_SIGNATURE: 'محتوای واقعی فایل با پسوند آن مطابقت ندارد.',
      EXTRACTED_TEXT_EMPTY: 'متن قابل استخراج در فایل جدید وجود ندارد.',
    };
    const msg = messageMap[code];
    if (!msg) {
      logger.error('admin.kb.document_replace_failed', { error: code });
    }
    return NextResponse.json(
      { error: msg || 'خطا در جایگزینی فایل سند.', code },
      { status: msg ? 400 : 500 }
    );
  }
}
