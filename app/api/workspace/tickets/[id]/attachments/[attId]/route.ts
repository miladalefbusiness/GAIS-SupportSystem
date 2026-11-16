import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { getOperatorAttachmentForDownload } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; attId: string }> }
) {
  const guard = await requirePermission('desk:workspace:access');
  if (!guard.ok) return guard.response;

  const { id, attId } = await context.params;
  try {
    const attachment = await getOperatorAttachmentForDownload(
      guard.session.access,
      id,
      attId
    );
    if (!attachment) {
      return NextResponse.json({ error: 'فایل پیوست یافت نشد.' }, { status: 404 });
    }

    const buffer = await getStorageDriver().get(attachment.storageKey);
    const encodedName = encodeURIComponent(attachment.originalFilename);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در دانلود فایل پیوست.');
  }
}
