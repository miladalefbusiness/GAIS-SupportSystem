# راهنمای استقرار (Deployment)

## پیش‌نیازها
- سیستم‌عامل لینوکس با Docker Engine و Docker Compose v2
- ابزارهای `openssl` و `bash`
- دسترسی پورت‌های `80` و `443` برای پراکسی معکوس Caddy (HTTPS خودکار)

## نصب اولیه با یک دستور

```bash
chmod +x bin/supportdesk
./bin/supportdesk install
```

مراحل اجراشده توسط `supportdesk install`:
1. بررسی پیش‌نیازهای Docker و OpenSSL.
2. ساخت دایرکتوری‌های پایدار `backups/` و `data/storage/`.
3. ایجاد `.env` از روی `.env.example` با تولید اسرار تصادفی (`BETTER_AUTH_SECRET`، `APP_ENCRYPTION_KEY`، `APP_HMAC_KEY`، رمزهای پایگاه داده و رمز اولیه بوت‌استرپ) بدون بازنویسی `.env` موجود.
4. راه‌اندازی سرویس PostgreSQL 16 و انتظار تا وضعیت سالم (`pg_isready`).
5. ساخت و اجرای کانتینر برنامه با تگ نسخه صریح (`APP_VERSION` — هرگز `latest`).
6. اجرای خودکار مهاجرت‌های Drizzle (`scripts/migrate.ts`) و بوت‌استرپ تک‌باره (`scripts/bootstrap.ts`).
7. راه‌اندازی پراکسی Caddy و بررسی Endpoint سلامت `/api/health/ready`.

## دستورات مدیریت روزانه
- مشاهده وضعیت: `./bin/supportdesk status`
- مشاهده لاگ‌ها: `./bin/supportdesk logs app`
- مشاهده نسخه جاری: `./bin/supportdesk version`
- بروزرسانی به نسخه جدید: `./bin/supportdesk update 0.2.0`
