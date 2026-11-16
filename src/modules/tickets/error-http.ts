import { NextResponse } from 'next/server';

export function mapTicketDomainError(error: unknown, fallbackMessage: string) {
  const msg = error instanceof Error ? error.message : '';

  if (msg.startsWith('INVALID_NATIONAL_ID:')) {
    return NextResponse.json(
      { error: msg.slice('INVALID_NATIONAL_ID:'.length) || 'کد ملی نامعتبر است.' },
      { status: 400 }
    );
  }
  if (msg === 'INVALID_PHONE_NUMBER') {
    return NextResponse.json(
      { error: 'شماره همراه واردشده معتبر نیست (فرمت صحیح: 09123456789).' },
      { status: 400 }
    );
  }
  if (msg.startsWith('RATE_LIMITED:')) {
    const retry = msg.split(':')[1] || '60';
    return NextResponse.json(
      { error: `تعداد درخواست‌ها بیش از حد مجاز است. لطفاً ${retry} ثانیه دیگر تلاش کنید.` },
      { status: 429, headers: { 'Retry-After': retry } }
    );
  }
  if (msg === 'OTP_PROVIDER_DISABLED_IN_PRODUCTION' || msg === 'OTP_WEBHOOK_NOT_CONFIGURED') {
    return NextResponse.json(
      { error: 'سرویس ارسال کد تأیید پیامکی پیکربندی نشده است.' },
      { status: 503 }
    );
  }
  if (msg === 'OTP_DELIVERY_FAILED') {
    return NextResponse.json(
      { error: 'ارسال کد تأیید با خطا مواجه شد. لطفاً مجدداً تلاش کنید.' },
      { status: 502 }
    );
  }
  if (msg === 'OTP_CHALLENGE_NOT_FOUND') {
    return NextResponse.json({ error: 'درخواست کد تأیید یافت نشد.' }, { status: 404 });
  }
  if (msg === 'OTP_ALREADY_USED') {
    return NextResponse.json({ error: 'این کد تأیید قبلاً استفاده شده است.' }, { status: 400 });
  }
  if (msg === 'OTP_EXPIRED') {
    return NextResponse.json({ error: 'اعتبار کد تأیید منقضی شده است.' }, { status: 400 });
  }
  if (msg === 'OTP_MAX_ATTEMPTS_EXCEEDED') {
    return NextResponse.json(
      { error: 'تعداد تلاش‌های ناموفق به سقف مجاز رسید. لطفاً کد جدید درخواست کنید.' },
      { status: 429 }
    );
  }
  if (msg === 'OTP_INVALID_CODE') {
    return NextResponse.json({ error: 'کد تأیید واردشده اشتباه است.' }, { status: 400 });
  }
  if (msg === 'DEPARTMENT_NOT_AVAILABLE' || msg === 'TARGET_DEPARTMENT_NOT_AVAILABLE') {
    return NextResponse.json(
      { error: 'دپارتمان انتخاب‌شده در حال حاضر فعال نیست.' },
      { status: 400 }
    );
  }
  if (msg === 'DEPARTMENT_ACCESS_DENIED' || msg === 'FORBIDDEN_PERMISSION') {
    return NextResponse.json(
      { error: 'شما مجوز دسترسی به این دپارتمان یا عملیات را ندارید.' },
      { status: 403 }
    );
  }
  if (msg === 'TARGET_OPERATOR_NOT_ELIGIBLE') {
    return NextResponse.json(
      { error: 'اپراتور انتخاب‌شده عضو فعال این دپارتمان نیست.' },
      { status: 400 }
    );
  }
  if (msg === 'CONVERSATION_NOT_FOUND') {
    return NextResponse.json({ error: 'گفت‌وگوی مورد نظر یافت نشد.' }, { status: 404 });
  }
  if (msg === 'CONVERSATION_OWNERSHIP_MISMATCH') {
    return NextResponse.json(
      { error: 'این گفت‌وگو قبلاً توسط کاربر دیگری ثبت شده است.' },
      { status: 403 }
    );
  }
  if (msg === 'TICKET_CLOSED') {
    return NextResponse.json(
      { error: 'این تیکت بسته شده است و امکان ارسال پیام جدید وجود ندارد.' },
      { status: 400 }
    );
  }
  if (msg === 'TOO_MANY_ATTACHMENTS') {
    return NextResponse.json(
      { error: 'حداکثر ۵ فایل پیوست در هر پیام مجاز است.' },
      { status: 400 }
    );
  }
  if (msg === 'EMPTY_ATTACHMENT') {
    return NextResponse.json({ error: 'فایل پیوست خالی است.' }, { status: 400 });
  }
  if (msg === 'ATTACHMENT_TOO_LARGE') {
    return NextResponse.json(
      { error: 'حجم فایل پیوست بیشتر از سقف مجاز دپارتمان است.' },
      { status: 413 }
    );
  }
  if (msg === 'UNSUPPORTED_ATTACHMENT_TYPE' || msg === 'INVALID_ATTACHMENT_SIGNATURE') {
    return NextResponse.json(
      {
        error:
          'نوع یا امضای فایل پیوست مجاز نیست. فرمت‌های مجاز: PNG، JPEG، WebP، PDF، DOCX، TXT، MD.',
      },
      { status: 400 }
    );
  }
  if (msg === 'ATTACHMENT_MALWARE_DETECTED') {
    return NextResponse.json(
      { error: 'فایل پیوست به دلایل امنیتی مسدود شد.' },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
