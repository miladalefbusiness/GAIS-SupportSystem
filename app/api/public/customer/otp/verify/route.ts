import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { verifyCustomerOtpSchema } from '@/src/modules/customers/schemas.ts';
import {
  CUSTOMER_SESSION_COOKIE,
  verifyCustomerOtp,
} from '@/src/modules/customers/service.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = verifyCustomerOtpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'کد تأیید نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await verifyCustomerOtp({
      challengeId: parsed.data.challengeId,
      otpCode: parsed.data.otpCode,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json({
      customer: result.customer,
      expiresAt: result.expiresAt.toISOString(),
    });

    response.cookies.set(CUSTOMER_SESSION_COOKIE, result.rawSessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: result.expiresAt,
    });

    return response;
  } catch (error) {
    logger.warn('public.customer.otp_verify_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return mapTicketDomainError(error, 'خطا در بررسی کد تأیید.');
  }
}
