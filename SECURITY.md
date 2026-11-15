# معماری امنیت (Security)

## اصول امنیتی پیاده‌سازی‌شده در فاز ۱

1. **کنترل دسترسی سمت سرور (Deny-by-Default RBAC)**:
   - تمام Endpointهای محافظت‌شده از `requireAuth` و `requirePermission` در سمت سرور استفاده می‌کنند.
   - مجوزهای موثر از ترکیب نقش‌های کاربر در جدول `user_roles` و استثناهای `allow`/`deny` در `user_permission_overrides` محاسبه می‌شوند (`deny` همیشه اولویت دارد).
   - کاربران جدید احراز هویت‌شده از طریق گوگل به صورت پیش‌فرض فقط نقش `viewer` بدون مجوز عملیاتی دریافت می‌کنند.

2. **امنیت حساب مدیر ارشد اولیه (Bootstrap)**:
   - نام کاربری و رمز اولیه تنها از متغیرهای محیطی خوانده می‌شوند و هرگز در کد منبع ذخیره نمی‌گردند.
   - رمز عبور با `scrypt` از طریق `better-auth/crypto` هش می‌شود.
   - قفل تراکنشی PostgreSQL (`pg_advisory_xact_lock`) و بررسی `bootstrap_completed` تضمین می‌کنند در ری‌استارت‌ها یا استقرارهای بعدی حساب فعلی هرگز بازنویسی نشود.
   - پرچم `mustChangePassword = true` کاربر را در اولین ورود به مسیر `/auth/change-password` هدایت کرده و دسترسی به APIهای پنل را تا پیش از تغییر رمز مسدود می‌کند (`403 PASSWORD_CHANGE_REQUIRED`).

3. **نشست‌ها، کوکی‌ها و محافظت از Brute-Force**:
   - نشست‌ها در جدول `authentication_sessions` ذخیره و در کوکی `HttpOnly`، `SameSite=Lax` (و `Secure` در Production) نگهداری می‌شوند.
   - اعتبارسنجی نشست در برابر PostgreSQL انجام می‌شود تا ابطال نشست بلافاصله اعمال شود.
   - مسیر `/api/auth/login` و `/api/auth/[...all]` دارای Rate Limiting بر پایه IP و شناسه کاربر هستند.

4. **ایمنی فایل‌ها و عدم افشای اسرار**:
   - دایرکتوری ذخیره‌سازی خارج از ریشه عمومی (`public/`) قرار دارد.
   - `LocalDiskStorageDriver` هرگونه کاراکتر غیرمجاز یا تلاش Path Traversal (`..`) را مسدود می‌کند.
   - لاگر ساختاریافته (`src/core/logging/logger.ts`) کلیدهای حساس (`password`, `token`, `secret`, `apiKey`, `nationalId`, `cookie`) را پیش از ثبت حذف/سانسور می‌کند.
   - هدرهای امنیتی HTTP (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) در Next.js و Caddy فعال هستند.
