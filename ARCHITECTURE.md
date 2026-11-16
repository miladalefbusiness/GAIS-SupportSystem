# معماری سامانه (Architecture)

این سامانه با الگوی **ماژولار منولیت (Modular Monolith)** بر پایه **Next.js App Router + TypeScript + PostgreSQL + Drizzle ORM** پیاده‌سازی شده است.

## لایه‌ها و ساختار پوشه‌ها

- `app/` — مسیرهای وب و API Routes (بدون نیاز به میکروسرویس یا Redis در نسخه ۱):
  - `app/page.tsx` — پوسته پورتال عمومی (RTL فارسی) با بارگذاری پویا دپارتمان‌های فعال، تنظیمات برندینگ و بخش پیگیری تیکت مشتری.
  - `app/(auth)/login` و `app/(auth)/change-password` — احراز هویت کارکنان و چرخش اجباری رمز عبور.
  - `app/(workspace)/workspace/**` — پوسته یکپارچه اپراتورها و مدیر ارشد با تعویض‌گر فضای کاری (`/workspace/desk`، `/workspace/files`) و پنل مدیریت سازمان (`/workspace/admin/departments`، `/operators`، `/roles`، `/knowledge`، `/ai-settings`، `/ai-reports`، `/storage`، `/reports`، `/audit`، `/settings`، `/health`).
  - `middleware.ts` — کنترل مبدا (Origin/CSRF) برای درخواست‌های تغییردهنده وضعیت روی `/api/*`.
  - `app/api/health` و `app/api/health/ready` — بررسی سلامت Liveness و Readiness.
  - `app/api/auth/*` — مسیرهای Better Auth، ورود با نام کاربری/رمز، تایید Firebase Google Sign-In، تغییر رمز با محدودیت نرخ و خروج.
  - `app/api/public/*` — دپارتمان‌های فعال، گفت‌وگوی هوشمند و ارجاع به اپراتور، احراز هویت کد ملی + OTP و ثبت/پاسخ/پیوست تیکت مشتری.
  - `app/api/workspace/*` — مسیرهای عملیاتی اپراتورها (`desk` و `files`) با بررسی مرزبندی دپارتمان (`requireDepartmentAccess`) و حضور اپراتور.
  - `app/api/admin/*` — مسیرهای مدیریت دپارتمان‌ها، اعضا، اپراتورها، نقش‌ها، مخزن دانش، AI، سهمیه‌های فایل، تنظیمات سامانه، گزارش‌ها، ممیزی و سلامت سیستم.
- `src/db/` — تعریف Schema در `schema.ts`، پیکربندی Pool با Object Method در `index.ts` (اتصال تنبل بدون Probe در زمان بارگذاری ماژول) و تنظیمات `drizzle-kit`.
- `src/core/` — هسته مشترک مستقل از ماژول‌های کسب‌وکار:
  - `config/env.ts` — اعتبارسنجی متغیرهای محیطی با Zod.
  - `auth/` — Better Auth + ارزیاب RBAC و مرزبندی دپارتمانی سمت سرور + کاتالوگ مجوزها.
  - `audit/audit.ts` — ثبت غیرقابل دستکاری رویدادهای ممیزی در PostgreSQL.
  - `security/` — رمزنگاری AES-256-GCM، HMAC-SHA256، کنترل Origin و محدودکننده نرخ (Rate Limiting).
  - `storage/` — انتزاع `StorageDriver` با پیاده‌سازی `LocalDiskStorageDriver` خارج از ریشه وب.
  - `bootstrap/superadmin.ts` — بوت‌استرپ تک‌باره و امن مدیر ارشد و نقش‌های سیستمی با قفل `pg_advisory_xact_lock`.
- `src/modules/` — ماژول‌های دامنه (`departments`، `operators`، `roles`، `knowledge`، `ai`، `customers`، `tickets`، `files`، `admin`) شامل Schema اعتبارسنجی Zod و سرویس‌های تراکنشی PostgreSQL.
- `docker/` و `bin/supportdesk` — بسته‌بندی استقرار خودمیزبان با Docker Compose، پراکسی معکوس Caddy و CLI مدیریت (نصب، بروزرسانی، پشتیبان‌گیری و بازیابی تاییدشده).

## محدودیت‌های عملیاتی شناخته‌شده و مسیر توسعه آینده
- محدودکننده نرخ درخواست‌ها درون‌پردازه‌ای (In-Memory) است و برای استقرار چندنمونه‌ای هم‌زمان می‌تواند به جدول متمرکز PostgreSQL یا Redis متصل شود.
- درایور ذخیره‌سازی فعلی محلی (`local`) با حجم پایدار است و از طریق رابط `StorageDriver` امکان افزودن درایور S3-Compatible در آینده بدون تغییر ماژول‌های دامنه فراهم است.
- حالت `OTP_DELIVERY_MODE=dev_mock` و `AV_SCANNER_MODE=disabled` صرفاً مناسب محیط توسعه/آزمایش هستند و برای محیط تولید باید به `sms_webhook` و `clamav` پیکربندی شوند.

