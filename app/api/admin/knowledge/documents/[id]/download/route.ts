import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getKnowledgeDocumentDownload } from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  try {
    const file = await getKnowledgeDocumentDownload(id);
    if (!file) {
      return NextResponse.json({ error: 'سند یافت نشد.' }, { status: 404 });
    }

    const encodedFilename = encodeURIComponent(file.originalFilename);
    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Length': String(file.byteSize),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('admin.kb.document_download_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فایل سند.' },
      { status: 500 }
    );
  }
}
