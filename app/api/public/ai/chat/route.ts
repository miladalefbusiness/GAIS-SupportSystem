import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { handleCustomerAiMessage } from '@/src/modules/ai/chat.ts';
import { sendPublicAiMessageSchema } from '@/src/modules/ai/schemas.ts';
import {
  getAuthenticatedCustomerSession,
  resolveOrCreateCustomerByIdentity,
} from '@/src/modules/customers/service.ts';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { ipAddress } = extractRequestContext(req.headers);

  try {
    const body = await req.json();
    const parsed = sendPublicAiMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'اطلاعات پیام نامعتبر است.' },
        { status: 400 }
      );
    }

    const customerSession = await getAuthenticatedCustomerSession();
    let customerProfileId: string | null = customerSession?.customer.id ?? null;

    if (!customerProfileId && parsed.data.nationalId && parsed.data.fullName) {
      const resolved = await resolveOrCreateCustomerByIdentity({
        nationalId: parsed.data.nationalId,
        fullName: parsed.data.fullName,
      });
      customerProfileId = resolved.id;
    } else if (!customerProfileId && !parsed.data.conversationId) {
      return NextResponse.json(
        {
          error:
            'لطفاً برای شروع گفت‌وگو و ثبت سوابق، کد ملی و نام و نام خانوادگی خود را وارد کنید.',
        },
        { status: 400 }
      );
    }

    const result = await handleCustomerAiMessage({
      departmentId: parsed.data.departmentId,
      conversationId: parsed.data.conversationId,
      customerProfileId,
      message: parsed.data.message,
      ipAddress,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('INVALID_NATIONAL_ID:')) {
      return NextResponse.json(
        { error: message.slice('INVALID_NATIONAL_ID:'.length) },
        { status: 400 }
      );
    }
    if (message.startsWith('RATE_LIMITED:')) {
      const retryAfter = Number(message.split(':')[1]) || 60;
      return NextResponse.json(
        {
          error: 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
          code: 'RATE_LIMITED',
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfter) },
        }
      );
    }
    if (message === 'DEPARTMENT_NOT_AVAILABLE') {
      return NextResponse.json(
        { error: 'دپارتمان انتخاب‌شده در حال حاضر فعال یا در دسترس نیست.' },
        { status: 404 }
      );
    }
    if (message === 'CONVERSATION_DEPARTMENT_MISMATCH') {
      return NextResponse.json(
        { error: 'این گفت‌وگو متعلق به دپارتمان انتخاب‌شده نیست.' },
        { status: 400 }
      );
    }

    logger.error('public.ai.chat_failed', { error: message });
    return NextResponse.json(
      { error: 'خطا در پردازش پیام. لطفاً دوباره تلاش کنید.' },
      { status: 500 }
    );
  }
}
