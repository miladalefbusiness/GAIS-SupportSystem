import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateCollectionSchema } from '@/src/modules/knowledge/schemas.ts';
import { updateKnowledgeCollection } from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateCollectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await updateKnowledgeCollection({
      id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'مجموعه دانش یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('unique')) {
      return NextResponse.json(
        { error: 'این شناسه انگلیسی قبلاً استفاده شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.kb.collection_update_failed', { error: msg });
    return NextResponse.json(
      { error: 'خطا در ویرایش مجموعه دانش.' },
      { status: 500 }
    );
  }
}
