import { NextResponse } from 'next/server';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { listAuthorizedDepartmentsForOperator } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requirePermission('desk:workspace:access');
  if (!guard.ok) return guard.response;

  const departments = await listAuthorizedDepartmentsForOperator(
    guard.session.access
  );
  return NextResponse.json({ departments });
}
