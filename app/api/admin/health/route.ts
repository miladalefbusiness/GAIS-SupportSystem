import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getSystemHealthDiagnostics } from '@/src/modules/admin/health.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission([
    'admin:panel:access',
    'admin:settings:manage',
    'admin:storage:manage',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const diagnostics = await getSystemHealthDiagnostics();
    return NextResponse.json(diagnostics);
  } catch (error) {
    logger.error('admin.health.diagnostics_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت وضعیت سلامت سیستم.' },
      { status: 500 }
    );
  }
}
