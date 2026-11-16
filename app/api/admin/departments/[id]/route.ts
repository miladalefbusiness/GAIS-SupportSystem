import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateDepartmentSchema } from '@/src/modules/departments/schemas.ts';
import { updateDepartment } from '@/src/modules/departments/service.ts';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:departments:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await updateDepartment({
      id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'دپارتمان یافت نشد.' }, { status: 404 });
    }

    revalidatePath('/');
    return NextResponse.json({ department: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('departments_slug_unique_idx') || message.includes('unique')) {
      return NextResponse.json(
        { error: 'این شناسه (slug) تکراری است.' },
        { status: 409 }
      );
    }
    logger.error('admin.departments.update_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در بروزرسانی دپارتمان.' },
      { status: 500 }
    );
  }
}
