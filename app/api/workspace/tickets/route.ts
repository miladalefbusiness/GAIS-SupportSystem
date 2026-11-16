import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { listOperatorTickets } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('desk:workspace:access');
  if (!guard.ok) return guard.response;

  const { searchParams } = req.nextUrl;
  const tabParam = searchParams.get('tab');
  const tab =
    tabParam === 'mine' || tabParam === 'unassigned' ? tabParam : 'department';
  const sortParam = searchParams.get('sort');
  const sort =
    sortParam === 'oldest' || sortParam === 'priority' ? sortParam : 'newest';

  try {
    const result = await listOperatorTickets(guard.session.access, {
      tab,
      departmentId: searchParams.get('departmentId') || undefined,
      status: searchParams.get('status') || undefined,
      priority: searchParams.get('priority') || undefined,
      q: searchParams.get('q') || undefined,
      sort,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      pageSize: searchParams.get('pageSize')
        ? Number(searchParams.get('pageSize'))
        : 20,
    });

    return NextResponse.json(result);
  } catch (error) {
    return mapTicketDomainError(error, 'خطا در بارگذاری فهرست تیکت‌ها.');
  }
}
