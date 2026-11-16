import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission, requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getInternalAiProviderRuntimeConfig } from '@/src/modules/ai/settings.ts';
import {
  enqueueBulkReindexJobs,
  listIngestionJobsAdmin,
  processPendingIngestionJobs,
} from '@/src/modules/rag/jobs/ingestion-worker.ts';
import { getEmbeddingIndexHealth } from '@/src/modules/rag/stores/pg-vector.ts';

export const dynamic = 'force-dynamic';

const jobActionSchema = z.object({
  action: z.enum(['reindex_all', 'reindex_mismatched', 'process_pending']),
});

export async function GET() {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  try {
    const config = await getInternalAiProviderRuntimeConfig();
    const [jobs, indexHealth] = await Promise.all([
      listIngestionJobsAdmin(40),
      getEmbeddingIndexHealth(config.embeddingModel),
    ]);

    return NextResponse.json({ jobs, indexHealth });
  } catch (error) {
    logger.error('admin.kb.jobs_list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت وضعیت صف پردازش و سلامت ایندکس.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = jobActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'عملیات درخواستی نامعتبر است.' },
        { status: 400 }
      );
    }

    const config = await getInternalAiProviderRuntimeConfig();

    if (parsed.data.action === 'process_pending') {
      const summary = await processPendingIngestionJobs(10);
      return NextResponse.json({ ok: true, summary });
    }

    const result = await enqueueBulkReindexJobs({
      actorUserId: guard.session.user.id,
      onlyMismatchedModel:
        parsed.data.action === 'reindex_mismatched'
          ? config.embeddingModel
          : null,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true, ...result }, { status: 202 });
  } catch (error) {
    logger.error('admin.kb.jobs_action_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در اجرای عملیات صف پردازش ایندکس.' },
      { status: 500 }
    );
  }
}
