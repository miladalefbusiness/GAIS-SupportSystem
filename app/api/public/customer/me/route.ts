import { NextResponse } from 'next/server';
import { getAuthenticatedCustomerSession } from '@/src/modules/customers/service.ts';
import { listCustomerTickets } from '@/src/modules/tickets/service.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAuthenticatedCustomerSession();
  if (!session) {
    return NextResponse.json(
      { error: 'هویت مشتری تأیید نشده است.' },
      { status: 401 }
    );
  }

  const customerTickets = await listCustomerTickets(session.customer.id);
  return NextResponse.json({
    customer: session.customer,
    tickets: customerTickets,
  });
}
