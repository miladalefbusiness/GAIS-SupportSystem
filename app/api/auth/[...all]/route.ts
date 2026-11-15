import { toNextJsHandler } from 'better-auth/next-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/src/core/auth/auth.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const rate = checkRateLimit(`ba:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      }
    );
  }
  return handler.POST(req);
}
