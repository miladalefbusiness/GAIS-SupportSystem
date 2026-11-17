import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { buildSessionCookieOptions } from '@/src/core/auth/cookie-options.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { customerPasswordAuthSchema } from '@/src/modules/customers/schemas.ts';
import {
  authenticateCustomerWithPassword,
  CUSTOMER_SESSION_COOKIE,
} from '@/src/modules/customers/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = customerPasswordAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات ورود نامعتبر است.' },
        { status: 400 }
      );
    }

    const result = await authenticateCustomerWithPassword({
      nationalId: parsed.data.nationalId,
      password: parsed.data.password,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      mode: parsed.data.mode,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json({
      customer: result.customer,
      isFirstTimeSetup: result.isFirstTimeSetup,
    });

    response.cookies.set(
      CUSTOMER_SESSION_COOKIE,
      result.rawSessionToken,
      buildSessionCookieOptions(req, { expires: result.expiresAt })
    );

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('INVALID_NATIONAL_ID:')) {
      return NextResponse.json(
        { error: message.slice('INVALID_NATIONAL_ID:'.length) },
        { status: 400 }
      );
    }
    if (message === 'INVALID_PHONE_NUMBER') {
      return NextResponse.json(
        { error: 'شماره همراه واردشده معتبر نیست (مثال: 09123456789).' },
        { status: 400 }
      );
    }
    if (message === 'FIRST_TIME_SETUP_NEEDS_NAME') {
      return NextResponse.json(
        {
          error: 'برای ثبت رمز عبور بار اول، وارد کردن نام و نام خانوادگی الزامی است.',
          code: 'FIRST_TIME_SETUP_NEEDS_NAME',
        },
        { status: 400 }
      );
    }
    if (message === 'CUSTOMER_NEEDS_FIRST_TIME_PASSWORD') {
      return NextResponse.json(
        {
          error:
            'برای این کد ملی هنوز رمز عبوری ثبت نشده است. لطفاً از بخش «ثبت رمز عبور (بار اول)» رمز عبور خود را تعیین کنید.',
          code: 'NEEDS_FIRST_TIME_PASSWORD',
        },
        { status: 400 }
      );
    }
    if (message === 'PASSWORD_ALREADY_SET') {
      return NextResponse.json(
        {
          error:
            'برای این کد ملی قبلاً رمز عبور ثبت شده است. لطفاً از بخش «ورود با رمز عبور» استفاده کنید یا در صورت فراموشی با مدیر سامانه تماس بگیرید.',
          code: 'PASSWORD_ALREADY_SET',
        },
        { status: 409 }
      );
    }
    if (message === 'INVALID_CUSTOMER_CREDENTIALS') {
      return NextResponse.json(
        { error: 'کد ملی یا رمز عبور واردشده صحیح نیست.' },
        { status: 401 }
      );
    }
    if (message.startsWith('RATE_LIMITED:')) {
      const retryAfter = Number(message.split(':')[1]) || 60;
      return NextResponse.json(
        { error: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    logger.error('public.customer.auth_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در ورود به پورتال پیگیری تیکت.' },
      { status: 500 }
    );
  }
}
