import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { updateFileSchema } from '@/src/modules/files/schemas.ts';
import {
  deleteSharedFile,
  getFileDetailWithVersions,
  updateSharedFileMetadata,
} from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { id } = await context.params;
    const detail = await getFileDetailWithVersions(guard.session.access, id);
    return NextResponse.json(detail);
  } catch (error) {
    return mapFileHubError(error, 'خطا در دریافت اطلاعات فایل.');
  }
}

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
    const parsed = updateFileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات ویرایش فایل نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const file = await updateSharedFileMetadata(
      guard.session.access,
      id,
      parsed.data,
      ctx
    );
    return NextResponse.json({ file });
  } catch (error) {
    return mapFileHubError(error, 'خطا در بروزرسانی فایل.');
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
    const result = await deleteSharedFile(guard.session.access, id, ctx);
    return NextResponse.json(result);
  } catch (error) {
    return mapFileHubError(error, 'خطا در حذف فایل.');
  }
}
