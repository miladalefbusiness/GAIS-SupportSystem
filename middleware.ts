import { NextRequest, NextResponse } from 'next/server';
import { isAllowedMutationOrigin } from '@/src/core/security/origin.ts';

export function middleware(req: NextRequest) {
  const check = isAllowedMutationOrigin({
    method: req.method,
    originHeader: req.headers.get('origin'),
    hostHeader: req.headers.get('host'),
    forwardedHostHeader: req.headers.get('x-forwarded-host'),
    appUrl: process.env.APP_URL || null,
  });

  if (!check.allowed) {
    return NextResponse.json(
      {
        error: 'درخواست نامعتبر است (عدم تطابق مبدا امنیتی).',
        code: check.reason || 'CSRF_ORIGIN_MISMATCH',
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
