import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission, requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createQaSchema } from '@/src/modules/knowledge/schemas.ts';
import { createQaEntry, listQaEntriesAdmin } from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  try {
    const entries = await listQaEntriesAdmin();
    return NextResponse.json({ entries });
  } catch (error) {
    logger.error('admin.kb.qa_list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست پرسش‌وپاسخ‌ها.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = createQaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات پرسش‌وپاسخ نامعتبر است.' },
        { status: 400 }
      );
    }

    const entry = await createQaEntry({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    logger.error('admin.kb.qa_create_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در ایجاد پرسش‌وپاسخ.' },
      { status: 500 }
    );
  }
}
