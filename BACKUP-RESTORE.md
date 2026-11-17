# راهنمای پشتیبان‌گیری، بازیابی و نگهداری (Backup & Restore)

## پشتیبان‌گیری دستی و بسته‌بندی امن

```bash
supportdesk backup --all
supportdesk backup --database
supportdesk backup --files
```

هر اجرا یک بسته جامع و راستی‌آزمایی‌شده در مسیر `backups/` (با مجوز `chmod 700` و فایل خروجی `chmod 600`) ایجاد می‌کند:
- `backups/supportdesk_backup_<TIMESTAMP>_<MODE>.tar.gz` شامل:
  - `db.sql.gz`: خروجی `pg_dump --clean --if-exists --no-owner --no-privileges` (تاییدشده با `gzip -t`) در حالت `--all` یا `--database`
  - `storage.tar.gz`: آرشیو کامل حجم پایدار `/var/lib/supportdesk/storage` (پیوست‌های تیکت، مخزن فایل اشتراکی و اسناد پایگاه دانش) در حالت `--all` یا `--files`
  - `manifest.json`: نسخه فرمت، زمان UTC، نسخه برنامه (`appVersion`)، نسخه PostgreSQL و هش SHA256 اجزا
  - `config-metadata.json`: خلاصه تنظیمات غیرمحرمانه (`domainName`, `tz`, `dbMode`, `storageDriver`, `maxUploadMb`) بدون هیچ‌گونه رمز عبور یا کلید API
- فایل هم‌نام `.sha256` در کنار بسته برای راستی‌آزمایی یکپارچگی پیش از بازیابی

## فهرست‌بندی و سیاست نگهداری (Retention)

```bash
supportdesk backup list
supportdesk backup prune --keep 14
```

- دستور `backup list` اندازه، زمان UTC و وضعیت تطابق checksum هر بسته را نمایش می‌دهد (`verified` / `FAILED` / `missing`).
- پس از هر بکاپ، سیاست نگهداری بر اساس `BACKUP_RETENTION_COUNT` (پیش‌فرض `14`) نسخه‌های قدیمی‌تر را به‌صورت خودکار پاکسازی می‌کند.

## بازیابی ایمن (Restore)

```bash
supportdesk restore
# یا مشخص‌کردن مستقیم فایل:
supportdesk restore --file /opt/supportdesk/backups/supportdesk_backup_<TIMESTAMP>_all.tar.gz
```

فرآیند حفاظتی پیاده‌سازی‌شده در `bin/supportdesk`:
1. در صورت وجود فایل `.sha256` کناری، ابتدا `sha256sum -c` اجرا می‌شود و در صورت مغایرت عملیات بلافاصله متوقف می‌گردد.
2. سلامت آرشیو (`tar -tzf`, `gzip -t`) بررسی و محتوای `manifest.json` همراه با دامنه و نسخه مقصد نمایش داده می‌شود.
3. پیش از هرگونه تغییر، دریافت تایید صریح `RESTORE` از ترمینال الزامی است.
4. سرویس‌های `app` و `worker` موقتاً متوقف می‌شوند، پایگاه داده با `psql -v ON_ERROR_STOP=1` و فایل‌های `/var/lib/supportdesk/storage` بازیابی می‌گردند، سپس سرویس‌ها مجدداً بالا آمده و `/api/health/ready` تایید می‌شود.

> **سیاست Rollback در بروزرسانی‌ها**: هنگام اجرای `supportdesk update --version X.Y.Z` پیش از هر تغییر یک بکاپ کامل گرفته می‌شود. اگر کانتینر جدید در سلامت `/api/health/ready` شکست بخورد، CLI به‌صورت خودکار `APP_VERSION` را به نسخه قبلی برمی‌گرداند؛ با این حال در صورت اعمال مهاجرت‌های ناسازگار پایگاه داده، بازیابی از بکاپ پیش از ارتقا (`supportdesk restore --file ...`) مرجع قطعی بازگشت است.
