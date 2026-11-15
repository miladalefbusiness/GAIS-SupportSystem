# طراحی پایگاه داده و مهاجرت‌ها (Database)

پایگاه داده اصلی سامانه **PostgreSQL 16** با **Drizzle ORM** و **Drizzle Kit** است. تمام تغییرات ساختار جداول صرفاً از طریق مهاجرت‌های SQL نسخه‌بندی‌شده در پوشه `drizzle/` انجام می‌شود.

## جداول پیاده‌سازی‌شده در فاز ۱ (`src/db/schema.ts`)
- `users`: شناسه داخلی UUID (متن)، `username`، `email`، `firebase_uid`، وضعیت (`active`/`inactive`/`suspended`)، `must_change_password`، `is_bootstrap_admin`.
- `authentication_sessions`: توکن نشست، تاریخ انقضا، IP، User-Agent و روش احراز هویت.
- `authentication_accounts`: حساب‌های متصل (هش رمز `credential` یا اتصال `firebase_google`).
- `authentication_verifications`: توکن‌های تایید کوتاه‌مدت.
- `roles`، `permissions`، `user_roles`، `role_permissions`، `user_permission_overrides`: ساختار کامل RBAC سطح کنش.
- `storage_quotas`: سهمیه‌های حجمی ذخیره‌سازی (سراسری در فاز ۱؛ دپارتمانی و اپراتوری در فاز ۵).
- `system_settings`: تنظیمات پیکربندی و نشانگر اتمام بوت‌استرپ (`bootstrap_completed`).
- `audit_logs`: گزارش ممیزی تمام رویدادهای امنیتی و مدیریتی.

## اتصال و جداسازی دسترسی
- برنامه در زمان اجرا با کاربر محدود `SQL_USER` (فقط خواندن/نوشتن داده) متصل می‌شود.
- ابزار مهاجرت (`drizzle-kit` و `scripts/migrate.ts`) با کاربر مدیر `SQL_ADMIN_USER` اجرا می‌شود.
