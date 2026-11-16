import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { createAiProviderAdapter } from '@/src/modules/ai/provider.ts';
import {
  getInternalAiProviderRuntimeConfig,
  recordAiConnectionTestResult,
} from '@/src/modules/ai/settings.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requirePermission('ai:settings:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const config = await getInternalAiProviderRuntimeConfig();
    const adapter = createAiProviderAdapter(config);
    const result = await adapter.testConnection();

    await recordAiConnectionTestResult({
      ok: result.ok,
      messageFa: result.messageFa,
    });

    await recordAuditLog({
      actorUserId: guard.session.user.id,
      action: 'ai.provider.connection_tested',
      targetType: 'ai_provider_settings',
      targetId: 'default',
      ipAddress,
      userAgent,
      metadata: {
        providerType: config.providerType,
        model: config.chatModel,
        ok: result.ok,
        latencyMs: result.latencyMs,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('admin.ai.test_connection_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      {
        ok: false,
        latencyMs: 0,
        modelChecked: '',
        messageFa: 'خطای داخلی در بررسی اتصال به ارائه‌دهنده هوش مصنوعی.',
      },
      { status: 500 }
    );
  }
}
