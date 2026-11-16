import { NextRequest, NextResponse } from 'next/server';
import { requireDepartmentAccess } from '@/src/core/auth/guards.ts';
import { getAuthorizedDepartmentDetails } from '@/src/modules/departments/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const guard = await requireDepartmentAccess(id, 'desk:workspace:access');
  if (!guard.ok) return guard.response;

  const details = await getAuthorizedDepartmentDetails(id);
  if (!details) {
    return NextResponse.json({ error: 'دپارتمان یافت نشد.' }, { status: 404 });
  }

  return NextResponse.json(details);
}
