import { NextRequest, NextResponse } from 'next/server';
import {
  CUSTOMER_SESSION_COOKIE,
  revokeCustomerSessionByToken,
} from '@/src/modules/customers/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rawToken = req.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
  await revokeCustomerSessionByToken(rawToken);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(CUSTOMER_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
