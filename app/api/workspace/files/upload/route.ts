import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { FILE_ACCESS_POLICIES } from '@/src/modules/files/schemas.ts';
import { uploadSharedFile } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    const departmentId = String(formData.get('departmentId') || '').trim();
    const folderIdRaw = formData.get('folderId');
    const folderId =
      typeof folderIdRaw === 'string' && folderIdRaw.trim()
        ? folderIdRaw.trim()
        : null;
    const title =
      typeof formData.get('title') === 'string'
        ? String(formData.get('title')).trim()
        : undefined;
    const description =
      typeof formData.get('description') === 'string'
        ? String(formData.get('description')).trim()
        : undefined;
    const accessPolicyRaw =
      typeof formData.get('accessPolicy') === 'string'
        ? String(formData.get('accessPolicy')).trim()
        : 'inherit';

    const accessPolicy = (FILE_ACCESS_POLICIES as readonly string[]).includes(
      accessPolicyRaw
    )
      ? (accessPolicyRaw as (typeof FILE_ACCESS_POLICIES)[number])
      : 'inherit';

    if (!departmentId) {
      return NextResponse.json(
        { error: 'شناسه دپارتمان الزامی است.' },
        { status: 400 }
      );
    }

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'فایلی برای بارگذاری ارسال نشده است.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const ctx = extractRequestContext(req.headers);

    const file = await uploadSharedFile(
      guard.session.access,
      {
        departmentId,
        folderId,
        title,
        description,
        accessPolicy,
        filename: fileEntry.name || 'upload.bin',
        buffer,
      },
      ctx
    );

    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    return mapFileHubError(error, 'خطا در بارگذاری فایل.');
  }
}
