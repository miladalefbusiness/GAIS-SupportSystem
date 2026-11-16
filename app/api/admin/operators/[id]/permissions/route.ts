import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateOperatorPermissionsSchema } from '@/src/modules/operators/schemas.ts';
import { replaceOperatorPermissionOverrides } from '@/src/modules/operators/service.ts';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:roles:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateOperatorPermissionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'استثناهای مجوز نامعتبر است.' },
        { status: 400 }
      );
    }

    const ok = await replaceOperatorPermissionOverrides({
      targetUserId: id,
      overrides: parsed.data.overrides,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!ok) {
      return NextResponse.json({ error: 'کاربر یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_PERMISSION_IDS') {
      return NextResponse.json(
        { error: 'یک یا چند مجوز انتخاب‌شده معتبر نیستند.' },
        { status: 400 }
      );
    }
    logger.error('admin.operators.overrides_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ثبت استثناهای دسترسی کاربر.' },
      { status: 500 }
    );
  }
}
