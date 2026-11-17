import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import {
  deleteSystemUserAdmin,
  updateSystemUserAdmin,
} from '@/src/modules/customers/admin.ts';
import { adminUpdateSystemUserSchema } from '@/src/modules/customers/schemas.ts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  if (!guard.session.access.isSuperAdmin) {
    return NextResponse.json(
      { error: 'این بخش فقط برای مدیر ارشد سامانه (Superadmin) قابل دسترسی است.' },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = adminUpdateSystemUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات بروزرسانی نامعتبر است.' },
        { status: 400 }
      );
    }

    const updated = await updateSystemUserAdmin({
      targetCustomerId: id,
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!updated) {
      return NextResponse.json({ error: 'کاربر یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_PHONE_NUMBER') {
      return NextResponse.json(
        { error: 'شماره همراه واردشده معتبر نیست.' },
        { status: 400 }
      );
    }
    logger.error('admin.system_users.update_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در بروزرسانی اطلاعات کاربر.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  if (!guard.session.access.isSuperAdmin) {
    return NextResponse.json(
      { error: 'این بخش فقط برای مدیر ارشد سامانه (Superadmin) قابل دسترسی است.' },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const deleted = await deleteSystemUserAdmin({
      targetCustomerId: id,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!deleted) {
      return NextResponse.json({ error: 'کاربر یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json(deleted);
  } catch (error) {
    logger.error('admin.system_users.delete_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در حذف حساب کاربر.' },
      { status: 500 }
    );
  }
}
