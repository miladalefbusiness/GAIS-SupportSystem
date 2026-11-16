import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { getCustomerTicketDetail } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'احراز هویت مشتری انجام نشده است.' },
      { status: 401 }
    );
  }

  const { id } = await context.params;
  const ticket = await getCustomerTicketDetail(session.customer.id, id);
  if (!ticket) {
    return NextResponse.json({ error: 'تیکت یافت نشد.' }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}
