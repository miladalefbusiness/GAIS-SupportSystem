import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateQaSchema } from '@/src/modules/knowledge/schemas.ts';
import { deleteQaEntry, updateQaEntry } from '@/src/modules/knowledge/service.ts';

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
    const parsed = updateQaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await updateQaEntry({
      id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'پرسش‌وپاسخ یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('admin.kb.qa_update_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در ویرایش پرسش‌وپاسخ.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const deleted = await deleteQaEntry({
      id,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!deleted) {
      return NextResponse.json({ error: 'پرسش‌وپاسخ یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('admin.kb.qa_delete_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در حذف پرسش‌وپاسخ.' },
      { status: 500 }
    );
  }
}
