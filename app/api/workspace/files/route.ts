import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { listFileHubWorkspace } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireAnyPermission([
    'files:workspace:access',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = req.nextUrl;
    const data = await listFileHubWorkspace(guard.session.access, {
      departmentId: searchParams.get('departmentId') || undefined,
      folderId: searchParams.get('folderId') || undefined,
      search: searchParams.get('q') || undefined,
      extension: searchParams.get('extension') || undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapFileHubError(error, 'خطا در بارگذاری مخزن فایل اشتراکی.');
  }
}
