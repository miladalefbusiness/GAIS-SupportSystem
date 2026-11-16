import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapFileHubError } from '@/src/modules/files/error-http.ts';
import { grantFilePermissionSchema } from '@/src/modules/files/schemas.ts';
import {
  grantFilePermissionAdmin,
  revokeFilePermissionAdmin,
} from '@/src/modules/files/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireAnyPermission([
    'admin:storage:manage',
    'files:quotas:manage',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json();
    const parsed = grantFilePermissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات مجوز فایل نامعتبر است.' },
        { status: 400 }
      );
    }

    const ctx = extractRequestContext(req.headers);
    const permission = await grantFilePermissionAdmin(
      guard.session.access,
      parsed.data,
      ctx
    );
    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    return mapFileHubError(error, 'خطا در ثبت استثنای دسترسی فایل.');
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAnyPermission([
    'admin:storage:manage',
    'files:quotas:manage',
    'files:items:manage_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const id = req.nextUrl.searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json(
        { error: 'شناسه قانون دسترسی الزامی است.' },
        { status: 400 }
      );
    }
    const ctx = extractRequestContext(req.headers);
    const result = await revokeFilePermissionAdmin(guard.session.access, id, ctx);
    return NextResponse.json(result);
  } catch (error) {
    return mapFileHubError(error, 'خطا در حذف استثنای دسترسی فایل.');
  }
}
