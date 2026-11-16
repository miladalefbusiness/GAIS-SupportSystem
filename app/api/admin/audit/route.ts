import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { listAuditLogsAdmin } from '@/src/modules/admin/audit.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('admin:audit:view');
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = req.nextUrl;
    const data = await listAuditLogsAdmin({
      q: searchParams.get('q') || undefined,
      action: searchParams.get('action') || undefined,
      actorType: searchParams.get('actorType') || undefined,
      targetType: searchParams.get('targetType') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      pageSize: searchParams.get('pageSize')
        ? Number(searchParams.get('pageSize'))
        : 25,
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error('admin.audit.list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت گزارش‌های ممیزی.' },
      { status: 500 }
    );
  }
}
