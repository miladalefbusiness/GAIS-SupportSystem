# معماری سامانه (Architecture)

این سامانه با الگوی **ماژولار منولیت (Modular Monolith)** بر پایه **Next.js App Router + TypeScript + PostgreSQL + Drizzle ORM** پیاده‌سازی شده است.

## لایه‌ها و ساختار پوشه‌ها

- `app/` — مسیرهای وب و API Routes (بدون نیاز به میکروسرویس یا Redis در نسخه ۱):
  - `app/page.tsx` — پوسته پورتال عمومی (RTL فارسی).
  - `app/(auth)/login` و `app/(auth)/change-password` — احراز هویت کارکنان و چرخش اجباری رمز عبور.
  - `app/(workspace)/workspace` — پوسته یکپارچه اپراتورها و مدیر ارشد با منوی سمت راست RTL.
  - `app/api/health` و `app/api/health/ready` — بررسی سلامت Liveness و Readiness.
  - `app/api/auth/*` — مسیرهای Better Auth، ورود با نام کاربری/رمز، تایید Firebase Google Sign-In، تغییر رمز و خروج.
- `src/db/` — تعریف Schema در `schema.ts`، پیکربندی Pool با Object Method در `index.ts` (اتصال تنبل بدون Probe در زمان بارگذاری ماژول) و تنظیمات `drizzle-kit`.
- `src/core/` — هسته مشترک مستقل از ماژول‌های کسب‌وکار:
  - `config/env.ts` — اعتبارسنجی متغیرهای محیطی با Zod.
  - `auth/` — Better Auth + ارزیاب RBAC سمت سرور + کاتالوگ مجوزها.
  - `audit/audit.ts` — ثبت غیرقابل دستکاری رویدادهای ممیزی در PostgreSQL.
  - `security/` — رمزنگاری AES-256-GCM، HMAC-SHA256 و محدودکننده نرخ (Rate Limiting).
  - `storage/` — انتزاع `StorageDriver` با پیاده‌سازی اولیه `LocalDiskStorageDriver` خارج از ریشه وب (آماده افزودن درایور S3 در آینده).
  - `bootstrap/superadmin.ts` — بوت‌استرپ تک‌باره و امن مدیر ارشد و نقش‌های سیستمی با قفل `pg_advisory_xact_lock`.
- `docker/` و `bin/supportdesk` — بسته‌بندی استقرار خودمیزبان با Docker Compose، پراکسی معکوس Caddy و CLI مدیریت.

## محدودیت‌های شناخته‌شده در پایان فاز ۱
- جداول دپارتمان‌ها، تیکتینگ، مخزن دانش، تنظیمات AI و فایل‌های اشتراکی عمداً در فازهای ۲ تا ۵ اضافه می‌شوند.
- محدودکننده نرخ ورود در فاز ۱ درون‌پردازه‌ای (In-Memory) است؛ برای استقرارهای چندنمونه‌ای در آینده می‌توان آن را به PostgreSQL یا جدول متمرکز ارتقا داد.
