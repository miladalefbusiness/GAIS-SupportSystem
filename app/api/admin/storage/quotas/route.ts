import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { upsertQuotaSchema } from '@/src/modules/files/schemas.ts';
import { updateStorageQuotaAdmin } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const guard = await requireAnyPermission([
    'admin:storage:manage',
    'files:quotas:manage',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json();
    const parsed = upsertQuotaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'مقدار سهمیه نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const quota = await updateStorageQuotaAdmin(guard.session.access, parsed.data, ctx);
    return NextResponse.json({ quota });
  } catch (error) {
    return mapFileHubError(error, 'خطا در ثبت سهمیه ذخیره‌سازی.');
  }
}
