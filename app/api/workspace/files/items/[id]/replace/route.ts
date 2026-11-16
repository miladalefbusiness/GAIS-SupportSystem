import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { replaceSharedFile } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(
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
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    const changeNote =
      typeof formData.get('changeNote') === 'string'
        ? String(formData.get('changeNote')).trim()
        : undefined;

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'فایل جایگزین ارسال نشده است.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const ctx = extractRequestContext(req.headers);

    const file = await replaceSharedFile(
      guard.session.access,
      id,
      {
        filename: fileEntry.name || 'replacement.bin',
        buffer,
        changeNote,
      },
      ctx
    );

    return NextResponse.json({ file });
  } catch (error) {
    return mapFileHubError(error, 'خطا در جایگزینی نسخه فایل.');
  }
}
