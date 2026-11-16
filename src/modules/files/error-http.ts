import { NextResponse } from 'next/server';
import { logger } from '@/src/core/logging/logger.ts';

export class FileHubDomainError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'BAD_REQUEST'
      | 'CONFLICT'
      | 'QUOTA_EXCEEDED'
      | 'FILE_TOO_LARGE'
      | 'UNSUPPORTED_FILE_TYPE'
      | 'INVALID_FILE_SIGNATURE'
      | 'MALWARE_DETECTED'
      | 'AV_UNAVAILABLE',
    public readonly messageFa: string,
    public readonly status: number
  ) {
    super(messageFa);
    this.name = 'FileHubDomainError';
  }
}

export function mapFileHubError(error: unknown, fallbackFa: string): NextResponse {
  if (error instanceof FileHubDomainError) {
    return NextResponse.json(
      { error: error.messageFa, code: error.code },
      { status: error.status }
    );
  }

  const rawMessage = error instanceof Error ? error.message : 'Unknown error';

  if (rawMessage === 'EMPTY_FILE') {
    return NextResponse.json(
      { error: 'فایل انتخاب‌شده خالی است.', code: 'EMPTY_FILE' },
      { status: 400 }
    );
  }
  if (rawMessage === 'FILE_TOO_LARGE') {
    return NextResponse.json(
      { error: 'حجم فایل از سقف مجاز بارگذاری بیشتر است.', code: 'FILE_TOO_LARGE' },
      { status: 413 }
    );
  }
  if (rawMessage === 'UNSUPPORTED_FILE_TYPE') {
    return NextResponse.json(
      {
        error: 'این نوع فایل در سیاست مخزن فایل مجاز نیست.',
        code: 'UNSUPPORTED_FILE_TYPE',
      },
      { status: 400 }
    );
  }
  if (rawMessage === 'INVALID_FILE_SIGNATURE') {
    return NextResponse.json(
      {
        error: 'محتوای واقعی فایل با پسوند اعلام‌شده مطابقت ندارد یا غیرایمن است.',
        code: 'INVALID_FILE_SIGNATURE',
      },
      { status: 400 }
    );
  }
  if (rawMessage === 'MALWARE_DETECTED') {
    return NextResponse.json(
      {
        error: 'پویشگر امنیتی محتوای فایل را مشکوک تشخیص داد و بارگذاری رد شد.',
        code: 'MALWARE_DETECTED',
      },
      { status: 400 }
    );
  }
  if (rawMessage === 'AV_SCAN_UNAVAILABLE') {
    return NextResponse.json(
      {
        error: 'سرویس اجباری پویش بدافزار در دسترس نیست و فایل ذخیره نشد.',
        code: 'AV_UNAVAILABLE',
      },
      { status: 503 }
    );
  }

  logger.error('files.unexpected_error', { error: rawMessage });
  return NextResponse.json({ error: fallbackFa }, { status: 500 });
}
