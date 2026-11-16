import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateDepartmentMembersSchema } from '@/src/modules/departments/schemas.ts';
import { replaceDepartmentMembers } from '@/src/modules/departments/service.ts';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('admin:departments:manage');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateDepartmentMembersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'فهرست اعضا نامعتبر است.' },
        { status: 400 }
      );
    }

    const ok = await replaceDepartmentMembers({
      departmentId: id,
      members: parsed.data.members,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    if (!ok) {
      return NextResponse.json({ error: 'دپارتمان یافت نشد.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_USER_IDS') {
      return NextResponse.json(
        { error: 'یک یا چند کاربر انتخاب‌شده معتبر نیستند.' },
        { status: 400 }
      );
    }
    logger.error('admin.departments.members_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در بروزرسانی اعضای دپارتمان.' },
      { status: 500 }
    );
  }
}
