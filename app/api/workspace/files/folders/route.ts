import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { createFolderSchema } from '@/src/modules/files/schemas.ts';
import { createFolder } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json();
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات پوشه نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const folder = await createFolder(guard.session.access, parsed.data, ctx);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return mapFileHubError(error, 'خطا در ایجاد پوشه.');
  }
}
