import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { downloadSharedFile } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
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
    const versionParam = req.nextUrl.searchParams.get('version');
    const versionNumber = versionParam ? Number(versionParam) : undefined;
    if (
      versionNumber !== undefined &&
      (!Number.isInteger(versionNumber) || versionNumber < 1)
    ) {
      return NextResponse.json(
        { error: 'شماره نسخه نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const result = await downloadSharedFile(
      guard.session.access,
      id,
      versionNumber,
      ctx
    );

    const encodedName = encodeURIComponent(result.originalFilename);
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(result.buffer.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return mapFileHubError(error, 'خطا در دریافت فایل.');
  }
}
