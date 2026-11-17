# راهنمای استقرار (Deployment Architecture & Operations)

> برای راهنمای گام‌به‌گام نصب روی سرور جدید به `INSTALL.md` و برای فهرست کامل دستورات CLI به `CLI.md` مراجعه کنید.

## معماری استقرار Docker Compose

پشته تولیدی شامل چهار سرویس جداگانه در شبکه داخلی ایزوله (`internal`) است:

1. **`postgres` (`pgvector/pgvector:pg16`)**: پایگاه داده PostgreSQL 16 همراه با افزونه‌های `vector` و `pg_trgm`، بدون اکسپوز پورت عمومی روی اینترنت و با ذخیره پایدار در حجم `pg_data` (یا اتصال به PostgreSQL خارجی با `docker-compose.external-db.yml` هنگام `DB_MODE=external`).
2. **`app` (`${APP_IMAGE}:${APP_VERSION}`)**: خروجی `standalone` برنامه Next.js اجراشده با کاربر غیرروت `nextjs:nodejs` (UID/GID `1001`)، حجم پایدار `/var/lib/supportdesk/storage` (`storage_data`) و اجرای خودکار `env-check.ts`، `migrate.ts` و `bootstrap.ts` هنگام شروع.
3. **`worker` (`${APP_IMAGE}:${APP_VERSION}`)**: پردازشگر پس‌زمینه صف بلع اسناد RAG (`scripts/worker.ts`) با همین ایمیج نسخه‌بندی‌شده برای جلوگیری از ناهماهنگی نسخه، بازیابی خودکار Jobهای متوقف‌شده بیش از ۱۵ دقیقه و ثبت Heartbeat سلامت در `/tmp/supportdesk-worker-heartbeat`.
4. **`proxy` (`caddy:2-alpine`)**: پراکسی معکوس تنها روی پورت‌های `80` و `443` (TCP/UDP) با گواهینامه TLS خودکار Let's Encrypt، هدرهای امنیتی HTTP/HSTS و محدودیت حجم آپلود منطبق با `MAX_UPLOAD_MB`.

## نصب اولیه با یک دستور

```bash
curl -fsSL https://YOUR-DOMAIN/install.sh | sudo bash
```

یا از روی مخزن محلی:

```bash
sudo bash install.sh --local --dir /opt/supportdesk
```

اسکریپت `install.sh` پیش‌نیازهای سیستم‌عامل و Docker Compose v2 را نصب می‌کند، checksum نسخه (`SHA256SUMS`) را راستی‌آزمایی می‌کند، ویزارد تعاملی قابل ازسرگیری را اجرا می‌کند، اسرار رمزنگاری ۶۴ کاراکتری می‌سازد، مهاجرت‌ها و بوت‌استرپ مدیر ارشد را اجرا می‌کند، `/usr/local/bin/supportdesk` را متصل می‌سازد و پس از پاس شدن `/api/health/ready` گزارش نهایی را چاپ می‌کند.

## دستورات مدیریت روزانه

- مشاهده وضعیت سرویس‌ها و سلامت: `supportdesk status` و `supportdesk health`
- مشاهده لاگ‌ها: `supportdesk logs [app|worker|postgres|proxy|all]`
- شروع / توقف / راه‌اندازی مجدد: `supportdesk start`، `supportdesk stop`، `supportdesk restart [service]`
- مشاهده و بروزرسانی امن تنظیمات و AI: `supportdesk config`
- ترمیم غیرمخرب کانتینرها و مجوزها: `supportdesk repair`
- بازنصب کانتینرها با حفظ کامل داده‌ها: `supportdesk reinstall [--version X.Y.Z]`
- بروزرسانی نسخه‌بندی‌شده (همراه با بکاپ خودکار و Rollback): `supportdesk update --version <X.Y.Z>`
- مدیریت حساب‌های مدیران و بازیابی دسترسی: `supportdesk admin list|create|reset-password|disable|enable|force-password-change`
