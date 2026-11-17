import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { listSystemUsersAdmin } from '@/src/modules/customers/admin.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('admin:users:manage');
  if (!guard.ok) return guard.response;

  if (!guard.session.access.isSuperAdmin) {
    return NextResponse.json(
      { error: 'این بخش فقط برای مدیر ارشد سامانه (Superadmin) قابل دسترسی است.' },
      { status: 403 }
    );
  }

  try {
    const q = req.nextUrl.searchParams.get('q') || undefined;
    const users = await listSystemUsersAdmin(q);
    return NextResponse.json({ users });
  } catch (error) {
    logger.error('admin.system_users.list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست کاربران سامانه.' },
      { status: 500 }
    );
  }
}
