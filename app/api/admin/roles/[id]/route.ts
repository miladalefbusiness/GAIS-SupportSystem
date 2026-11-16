import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateRoleSchema } from '@/src/modules/roles/schemas.ts';
import { updateRole } from '@/src/modules/roles/service.ts';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:roles:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نقش نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await updateRole({
      roleId: id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json({ error: 'نقش یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'CANNOT_STRIP_SUPERADMIN_CORE_PERMS') {
      return NextResponse.json(
        { error: 'مجوزهای کلیدی نقش مدیر ارشد قابل حذف نیستند.' },
        { status: 400 }
      );
    }
    if (message === 'INVALID_PERMISSION_IDS') {
      return NextResponse.json(
        { error: 'یک یا چند مجوز انتخاب‌شده معتبر نیستند.' },
        { status: 400 }
      );
    }
    logger.error('admin.roles.update_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در بروزرسانی نقش.' },
      { status: 500 }
    );
  }
}
