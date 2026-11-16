import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission, requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import {
  listRagEvaluationRuns,
  runBuiltInRagEvaluationSuite,
} from '@/src/modules/rag/evaluation/suite.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission(['ai:reports:view', 'ai:settings:manage']);
  if (!guard.ok) return guard.response;

  try {
    const runs = await listRagEvaluationRuns(15);
    return NextResponse.json({ runs });
  } catch (error) {
    logger.error('admin.ai.evaluation_list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت سوابق ارزیابی RAG.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('ai:settings:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = (await req.json().catch(() => ({}))) as { runLabel?: string };
    const report = await runBuiltInRagEvaluationSuite({
      triggeredByUserId: guard.session.user.id,
      runLabel: typeof body.runLabel === 'string' ? body.runLabel.trim().slice(0, 120) : undefined,
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ report });
  } catch (error) {
    logger.error('admin.ai.evaluation_run_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در اجرای مجموعه ارزیابی ۸ دسته‌ای RAG.' },
      { status: 500 }
    );
  }
}
