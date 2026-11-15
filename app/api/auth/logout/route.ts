import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext, recordAuditLog } from '@/src/core/audit/audit.ts';
import {
  APP_SESSION_COOKIE,
  getCurrentSession,
  revokeDbSession,
} from '@/src/core/auth/auth.ts';

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);
  const session = await getCurrentSession();
  const cookieStore = await cookies();
  const token = cookieStore.get(APP_SESSION_COOKIE)?.value;

  if (token) {
    await revokeDbSession(token);
  }

  if (session) {
    await recordAuditLog({
      actorUserId: session.user.id,
      action: 'auth.logout',
      targetType: 'user',
      targetId: session.user.id,
      ipAddress,
      userAgent,
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(APP_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return response;
}
