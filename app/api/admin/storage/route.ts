import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { getStorageAdminOverview } from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission([
    'admin:storage:manage',
    'files:quotas:manage',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const overview = await getStorageAdminOverview(guard.session.access);
    return NextResponse.json(overview);
  } catch (error) {
    return mapFileHubError(error, 'خطا در بارگذاری وضعیت ذخیره‌سازی.');
  }
}
