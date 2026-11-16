import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { reprocessKnowledgeDocument } from '@/src/modules/knowledge/service.ts';

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
    const result = await reprocessKnowledgeDocument({
      documentId: id,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json({ error: 'سند یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'REPROCESS_FAILED';
    logger.error('admin.kb.document_reprocess_failed', { error: msg });
    return NextResponse.json(
      {
        error:
          msg === 'EXTRACTED_TEXT_EMPTY'
            ? 'متن قابل استخراج در سند یافت نشد.'
            : 'خطا در پردازش مجدد و قطعه‌بندی سند.',
      },
      { status: 422 }
    );
  }
}
