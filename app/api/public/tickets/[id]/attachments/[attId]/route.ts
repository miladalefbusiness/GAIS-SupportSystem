import { NextRequest, NextResponse } from 'next/server';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { getCustomerAttachmentForDownload } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; attId: string }> }
) {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'احراز هویت مشتری انجام نشده است.' },
      { status: 401 }
    );
  }

  const { id, attId } = await context.params;
  const attachment = await getCustomerAttachmentForDownload(
    session.customer.id,
    id,
    attId
  );
  if (!attachment) {
    return NextResponse.json({ error: 'فایل پیوست یافت نشد.' }, { status: 404 });
  }

  try {
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
  } catch {
    return NextResponse.json(
      { error: 'فایل پیوست در مخزن یافت نشد.' },
      { status: 404 }
    );
  }
}
