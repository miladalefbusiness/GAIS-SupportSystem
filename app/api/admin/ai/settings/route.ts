import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { updateAiProviderSettingsSchema } from '@/src/modules/ai/schemas.ts';
import {
  getSafeAiProviderSettings,
  listAllDepartmentAiConfigsAdmin,
  upsertAiProviderSettings,
} from '@/src/modules/ai/settings.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('ai:settings:manage');
  if (!guard.ok) return guard.response;

  try {
    const [provider, departmentConfigs] = await Promise.all([
      getSafeAiProviderSettings(),
      listAllDepartmentAiConfigsAdmin(),
    ]);
    return NextResponse.json({ provider, departmentConfigs });
  } catch (error) {
    logger.error('admin.ai.settings_get_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت تنظیمات هوش مصنوعی.' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission('ai:settings:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = updateAiProviderSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات تنظیمات نامعتبر است.' },
        { status: 400 }
      );
    }

    const provider = await upsertAiProviderSettings({
      input: parsed.data,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'BASE_URL_REQUIRED') {
      return NextResponse.json(
        { error: 'برای سرویس‌های سازگار با OpenAI، وارد کردن نشانی Base URL الزامی است.' },
        { status: 400 }
      );
    }
    logger.error('admin.ai.settings_update_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ذخیره تنظیمات ارائه‌دهنده هوش مصنوعی.' },
      { status: 500 }
    );
  }
}
