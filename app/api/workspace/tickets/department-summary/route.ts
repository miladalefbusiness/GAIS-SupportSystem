import { NextResponse } from 'next/server';
import { requireAnyPermission } from '@/src/core/auth/guards.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';
import { getDepartmentTicketQueueSummary } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAnyPermission([
    'desk:workspace:access',
    'desk:tickets:view_department',
    'desk:tickets:view_all',
  ]);
  if (!guard.ok) return guard.response;

  try {
    const summary = await getDepartmentTicketQueueSummary(guard.session.access);
    return NextResponse.json(summary);
  } catch (error) {
    return mapTicketDomainError(
      error,
      'خطا در دریافت آمار تیکت‌های دپارتمان‌ها.'
    );
  }
}
