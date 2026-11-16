import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { updateFolderSchema } from '@/src/modules/files/schemas.ts';
import { deleteFolder, updateFolder } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { id } = await context.params;
    const body = await req.json();
    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات ویرایش پوشه نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const folder = await updateFolder(guard.session.access, id, parsed.data, ctx);
    return NextResponse.json({ folder });
  } catch (error) {
    return mapFileHubError(error, 'خطا در بروزرسانی پوشه.');
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { id } = await context.params;
    const ctx = extractRequestContext(req.headers);
    const result = await deleteFolder(guard.session.access, id, ctx);
    return NextResponse.json(result);
  } catch (error) {
    return mapFileHubError(error, 'خطا در حذف پوشه.');
  }
}
