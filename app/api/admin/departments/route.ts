import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createDepartmentSchema } from '@/src/modules/departments/schemas.ts';
import {
  createDepartment,
  listAllDepartmentsAdmin,
} from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('admin:departments:manage');
  if (!guard.ok) return guard.response;

  try {
    const departments = await listAllDepartmentsAdmin();
    return NextResponse.json({ departments });
  } catch (error) {
    logger.error('admin.departments.list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست دپارتمان‌ها.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('admin:departments:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات دپارتمان نامعتبر است.' },
        { status: 400 }
      );
    }

    const created = await createDepartment({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    revalidatePath('/');
    return NextResponse.json({ department: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('departments_slug_unique_idx') || message.includes('unique')) {
      return NextResponse.json(
        { error: 'این شناسه (slug) قبلاً برای دپارتمان دیگری ثبت شده است.' },
        { status: 409 }
      );
    }
    logger.error('admin.departments.create_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ایجاد دپارتمان.' },
      { status: 500 }
    );
  }
}
