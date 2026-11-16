import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { listAiReportsAdmin } from '@/src/modules/ai/chat.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission(['ai:reports:view', 'ai:settings:manage']);
  if (!guard.ok) return guard.response;

  try {
    const reports = await listAiReportsAdmin();
    return NextResponse.json(reports);
  } catch (error) {
    logger.error('admin.ai.reports_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت گزارش‌های هوش مصنوعی.' },
      { status: 500 }
    );
  }
}
