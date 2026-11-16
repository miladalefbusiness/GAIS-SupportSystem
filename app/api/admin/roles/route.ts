import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createRoleSchema } from '@/src/modules/roles/schemas.ts';
import {
  createCustomRole,
  listRolesAndPermissionsAdmin,
} from '@/src/modules/roles/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('admin:roles:manage');
  if (!guard.ok) return guard.response;

  try {
    const data = await listRolesAndPermissionsAdmin();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('admin.roles.list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت نقش‌ها و مجوزها.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('admin:roles:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات نقش نامعتبر است.' },
        { status: 400 }
      );
    }

    const role = await createCustomRole({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_PERMISSION_IDS') {
      return NextResponse.json(
        { error: 'یک یا چند مجوز انتخاب‌شده معتبر نیستند.' },
        { status: 400 }
      );
    }
    if (message.includes('unique')) {
      return NextResponse.json(
        { error: 'این شناسه نقش قبلاً ثبت شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.roles.create_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ایجاد نقش جدید.' },
      { status: 500 }
    );
  }
}
