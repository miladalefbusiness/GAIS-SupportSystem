import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createOperatorSchema } from '@/src/modules/operators/schemas.ts';
import { createOperator, listOperatorsAdmin } from '@/src/modules/operators/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  try {
    const operators = await listOperatorsAdmin();
    return NextResponse.json({ operators });
  } catch (error) {
    logger.error('admin.operators.list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست اپراتورها.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = createOperatorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات اپراتور نامعتبر است.' },
        { status: 400 }
      );
    }

    const created = await createOperator({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ operator: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_ROLE_IDS' || message === 'INVALID_DEPARTMENT_IDS') {
      return NextResponse.json(
        { error: 'نقش یا دپارتمان انتخاب‌شده نامعتبر است.' },
        { status: 400 }
      );
    }
    if (message.includes('unique')) {
      return NextResponse.json(
        { error: 'نام کاربری یا ایمیل قبلاً ثبت شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.operators.create_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ایجاد حساب اپراتور.' },
      { status: 500 }
    );
  }
}
