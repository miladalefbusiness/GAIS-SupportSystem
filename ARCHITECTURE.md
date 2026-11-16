# معماری سامانه (Architecture)

این سامانه با الگوی **ماژولار منولیت (Modular Monolith)** بر پایه **Next.js App Router + TypeScript + PostgreSQL + Drizzle ORM** پیاده‌سازی شده است.

## لایه‌ها و ساختار پوشه‌ها

- `app/` — مسیرهای وب و API Routes (بدون نیاز به میکروسرویس یا Redis در نسخه ۱):
  - `app/page.tsx` — پوسته پورتال عمومی (RTL فارسی) با بارگذاری پویا دپارتمان‌های فعال و عمومی از PostgreSQL.
  - `app/(auth)/login` و `app/(auth)/change-password` — احراز هویت کارکنان و چرخش اجباری رمز عبور.
  - `app/(workspace)/workspace/**` — پوسته یکپارچه اپراتورها و مدیر ارشد با تعویض‌گر فضای کاری (`/workspace/desk`، `/workspace/files`) و پنل مدیریت سازمان (`/workspace/admin/departments`، `/workspace/admin/operators`، `/workspace/admin/roles`، `/workspace/admin/knowledge`، `/workspace/admin/ai-settings`، `/workspace/admin/ai-reports`).
  - `app/api/health` و `app/api/health/ready` — بررسی سلامت Liveness و Readiness.
  - `app/api/auth/*` — مسیرهای Better Auth، ورود با نام کاربری/رمز، تایید Firebase Google Sign-In، تغییر رمز و خروج.
  - `app/api/public/*` — دریافت دپارتمان‌های فعال و گفت‌وگوی هوشمند عمومی + درخواست ارجاع به اپراتور (`/api/public/ai/chat`، `/api/public/ai/conversations/[id]/handoff`).
  - `app/api/workspace/*` — مسیرهای عملیاتی اپراتورها با بررسی مرزبندی دپارتمان (`requireDepartmentAccess`) و تغییر وضعیت حضور.
  - `app/api/admin/*` — مسیرهای مدیریت دپارتمان‌ها، اعضا، اپراتورها، نقش‌ها، مخزن دانش، تنظیمات ارائه‌دهنده AI و گزارش‌های ردیابی.
- `src/db/` — تعریف Schema در `schema.ts`، پیکربندی Pool با Object Method در `index.ts` (اتصال تنبل بدون Probe در زمان بارگذاری ماژول) و تنظیمات `drizzle-kit`.
- `src/core/` — هسته مشترک مستقل از ماژول‌های کسب‌وکار:
  - `config/env.ts` — اعتبارسنجی متغیرهای محیطی با Zod.
  - `auth/` — Better Auth + ارزیاب RBAC و مرزبندی دپارتمانی سمت سرور + کاتالوگ مجوزها.
  - `audit/audit.ts` — ثبت غیرقابل دستکاری رویدادهای ممیزی در PostgreSQL.
  - `security/` — رمزنگاری AES-256-GCM، HMAC-SHA256 و محدودکننده نرخ (Rate Limiting).
  - `storage/` — انتزاع `StorageDriver` با پیاده‌سازی اولیه `LocalDiskStorageDriver` خارج از ریشه وب (آماده افزودن درایور S3 در آینده).
  - `bootstrap/superadmin.ts` — بوت‌استرپ تک‌باره و امن مدیر ارشد و نقش‌های سیستمی با قفل `pg_advisory_xact_lock`.
- `src/modules/` — ماژول‌های دامنه (`departments`، `operators`، `roles`، `knowledge`، `ai`) شامل Schema اعتبارسنجی Zod و سرویس‌های تراکنشی PostgreSQL.
- `docker/` و `bin/supportdesk` — بسته‌بندی استقرار خودمیزبان با Docker Compose، پراکسی معکوس Caddy و CLI مدیریت.

## وضعیت و محدودیت‌های شناخته‌شده در پایان فاز ۳
- جداول و جریان‌های احراز هویت مشتری (کد ملی + OTP) و تیکتینگ (فاز ۴) و مدیریت فایل‌های اشتراکی (فاز ۵) در فازهای بعدی اضافه می‌شوند.
- محدودکننده نرخ ورود و گفت‌وگوی عمومی درون‌پردازه‌ای (In-Memory) است؛ برای استقرارهای چندنمونه‌ای در آینده می‌توان آن را به جدول متمرکز PostgreSQL ارتقا داد.

