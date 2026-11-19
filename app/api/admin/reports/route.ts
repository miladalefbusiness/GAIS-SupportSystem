import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import {
  getOperationalReports,
  parseReportWindowDays,
} from '@/src/modules/admin/reports.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireAnyPermission([
    'admin:panel:access',
    'admin:audit:view',
    'desk:tickets:view_all',
    'ai:reports:view',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = req.nextUrl;
    const days = parseReportWindowDays(searchParams.get('days'), 30);
    const departmentId = searchParams.get('departmentId') || undefined;

    const data = await getOperationalReports({ days, departmentId });
    return NextResponse.json(data);
  } catch (error) {
    logger.error('admin.reports.get_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در تولید گزارش‌های عملیاتی.' },
      { status: 500 }
    );
  }
}
