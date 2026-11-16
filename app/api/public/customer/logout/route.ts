import { NextRequest, NextResponse } from 'next/server';
import { buildSessionCookieOptions } from '@/src/core/auth/cookie-options.ts';
import {
  CUSTOMER_SESSION_COOKIE,
  revokeCustomerSessionByToken,
} from '@/src/modules/customers/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rawToken = req.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
  await revokeCustomerSessionByToken(rawToken);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    '',
    buildSessionCookieOptions(req, { maxAge: 0 })
  );
  return response;
}
