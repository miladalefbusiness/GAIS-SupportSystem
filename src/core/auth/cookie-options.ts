import type { NextRequest } from 'next/server';

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax' | 'none';
  secure: boolean;
  partitioned?: boolean;
  path: '/';
  expires?: Date;
  maxAge?: number;
}

export function buildSessionCookieOptions(
  req: NextRequest,
  extra: { expires?: Date; maxAge?: number } = {}
): SessionCookieOptions {
  const forwardedProto = req.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const originHeader = req.headers.get('origin')?.toLowerCase() ?? '';
  const refererHeader = req.headers.get('referer')?.toLowerCase() ?? '';
  const hostHeader = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    ''
  ).toLowerCase();

  const isLocalHttp =
    hostHeader.startsWith('localhost') ||
    hostHeader.startsWith('127.0.0.1') ||
    hostHeader.startsWith('[::1]');

  const isHttps =
    forwardedProto === 'https' ||
    req.nextUrl.protocol === 'https:' ||
    originHeader.startsWith('https://') ||
    refererHeader.startsWith('https://') ||
    (!isLocalHttp && Boolean(process.env.APPLET_ID)) ||
    (!isLocalHttp && (process.env.APP_URL?.startsWith('https://') ?? false));

  const isEmbeddedContext =
    Boolean(process.env.APPLET_ID) ||
    req.headers.get('sec-fetch-dest') === 'iframe' ||
    req.headers.get('sec-fetch-site') === 'cross-site';

  // In HTTPS preview/embedded iframe contexts, browsers reject or withhold SameSite=Lax
  // cookies across cross-site frame boundaries. SameSite=None + Secure + Partitioned (CHIPS)
  // preserves session persistence both inside embedded frames and top-level HTTPS tabs,
  // while state-changing API requests remain protected by strict Origin validation in middleware.ts.
  if (isHttps && isEmbeddedContext) {
    return {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      partitioned: true,
      path: '/',
      ...extra,
    };
  }

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps || process.env.NODE_ENV === 'production',
    path: '/',
    ...extra,
  };
}
