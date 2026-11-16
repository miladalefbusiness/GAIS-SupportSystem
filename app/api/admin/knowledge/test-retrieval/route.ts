import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createAiProviderAdapter } from '@/src/modules/ai/provider.ts';
import { getInternalAiProviderRuntimeConfig } from '@/src/modules/ai/settings.ts';
import { testRetrievalSchema } from '@/src/modules/knowledge/schemas.ts';
import { runAdvancedRetrieval } from '@/src/modules/rag/retrieval/engine.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json();
    const parsed = testRetrievalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات آزمون بازیابی نامعتبر است.' },
        { status: 400 }
      );
    }

    const runtimeConfig = await getInternalAiProviderRuntimeConfig();
    const adapter = runtimeConfig.apiKey
      ? createAiProviderAdapter(runtimeConfig)
      : null;

    const result = await runAdvancedRetrieval({
      departmentId: parsed.data.departmentId,
      query: parsed.data.query,
      embeddingModel: runtimeConfig.embeddingModel,
      adapter,
      embedder:
        adapter && runtimeConfig.embeddingModel
          ? async (text: string) => {
              try {
                return await adapter.generateEmbedding(text);
              } catch {
                return null;
              }
            }
          : null,
      forcedStrategy: parsed.data.forcedStrategy ?? null,
      rerankerMode: parsed.data.rerankerMode ?? 'cross_feature',
      enableLlmQueryTransform: false,
      enableParentExpansion: true,
      finalLimit: 6,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('admin.kb.test_retrieval_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در اجرای آزمون بازیابی دانش.' },
      { status: 500 }
    );
  }
}
