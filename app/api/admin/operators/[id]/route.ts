import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateOperatorSchema } from '@/src/modules/operators/schemas.ts';
import { updateOperator } from '@/src/modules/operators/service.ts';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateOperatorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await updateOperator({
      targetUserId: id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!result) {
      return NextResponse.json({ error: 'کاربر یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (
      message === 'CANNOT_DISABLE_LAST_SUPERADMIN' ||
      message === 'CANNOT_REMOVE_LAST_SUPERADMIN_ROLE'
    ) {
      return NextResponse.json(
        { error: 'امکان غیرفعال‌سازی یا حذف نقش آخرین مدیر ارشد فعال سامانه وجود ندارد.' },
        { status: 400 }
      );
    }
    if (message === 'INVALID_ROLE_IDS' || message === 'INVALID_DEPARTMENT_IDS') {
      return NextResponse.json(
        { error: 'نقش یا دپارتمان انتخاب‌شده نامعتبر است.' },
        { status: 400 }
      );
    }
    if (message.includes('unique')) {
      return NextResponse.json(
        { error: 'ایمیل واردشده قبلاً برای کاربر دیگری ثبت شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.operators.update_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در بروزرسانی اطلاعات اپراتور.' },
      { status: 500 }
    );
  }
}
