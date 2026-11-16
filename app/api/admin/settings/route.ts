import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import {
  getPlatformSettings,
  platformSettingsSchema,
  updatePlatformSettings,
} from '@/src/modules/admin/settings.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('admin:settings:manage');
  if (!guard.ok) return guard.response;

  try {
    const result = await getPlatformSettings();
    return NextResponse.json(result);
  } catch (error) {
    logger.error('admin.settings.get_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت تنظیمات عمومی سامانه.' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission('admin:settings:manage');
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json();
    const parsed = platformSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'مقادیر تنظیمات نامعتبر است.' },
        { status: 400 }
      );
    }

    const { ipAddress, userAgent } = extractRequestContext(req.headers);
    const saved = await updatePlatformSettings({
      actorUserId: guard.session.user.id,
      input: parsed.data,
      ipAddress,
      userAgent,
    });

    revalidatePath('/');
    revalidatePath('/workspace');
    return NextResponse.json(saved);
  } catch (error) {
    logger.error('admin.settings.update_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در ذخیره تنظیمات عمومی سامانه.' },
      { status: 500 }
    );
  }
}
