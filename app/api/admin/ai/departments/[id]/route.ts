import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateDepartmentAiSettingsSchema } from '@/src/modules/ai/schemas.ts';
import { upsertDepartmentAiSettings } from '@/src/modules/ai/settings.ts';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('ai:settings:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateDepartmentAiSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'تنظیمات دپارتمان نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await upsertDepartmentAiSettings({
      departmentId: id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'دپارتمان یافت نشد.' }, { status: 404 });
    }

    revalidatePath('/');
    return NextResponse.json({ departmentConfig: updated });
  } catch (error) {
    logger.error('admin.ai.department_update_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در به‌روزرسانی تنظیمات هوش مصنوعی دپارتمان.' },
      { status: 500 }
    );
  }
}
