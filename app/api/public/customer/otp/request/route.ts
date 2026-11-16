import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { requestCustomerOtpSchema } from '@/src/modules/customers/schemas.ts';
import { requestCustomerOtp } from '@/src/modules/customers/service.ts';
import { mapTicketDomainError } from '@/src/modules/tickets/error-http.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = requestCustomerOtpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات واردشده نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await requestCustomerOtp({
      nationalId: parsed.data.nationalId,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      purpose: parsed.data.purpose,
      ipAddress,
      userAgent,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.warn('public.customer.otp_request_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return mapTicketDomainError(error, 'خطا در ارسال کد تأیید.');
  }
}
