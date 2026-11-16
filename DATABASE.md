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

## جداول اضافه‌شده در فاز ۲ (`drizzle/0001_last_starfox.sql`)
- `departments`: فهرست پویا دپارتمان‌های سازمانی شامل `slug` یکتا، `name_fa`، `description_fa`، `icon_key`، `display_order`، `is_active`، `is_public`، `ai_enabled`، `human_operators_available`، `assignment_strategy`، `welcome_message_fa`، `max_upload_size_mb`.
- `department_memberships`: رابطه چندبه‌چند بین دپارتمان‌ها و اپراتورها با نقش مدیر دپارتمان (`is_manager`)، آماده بودن دپارتمانی (`is_available`) و سقف تیکت هم‌زمان (`max_active_tickets`).
- `operator_availability`: وضعیت حضور سراسری اپراتور (`is_available`) و یادداشت کوتاه وضعیت.

## جداول اضافه‌شده در فاز ۳ (`drizzle/0002_crazy_oracle.sql`)
- `knowledge_collections` و `department_knowledge_collections`: دسته‌بندی دانش و اتصال چندبه‌چند به دپارتمان‌ها.
- `knowledge_documents`، `knowledge_document_versions`، `knowledge_document_departments` و `knowledge_chunks`: ذخیره فراداده اسناد استخراج‌شده، تاریخچه نسخه‌ها، دسترسی دپارتمانی و قطعات متنی + بردار اختیاری.
- `knowledge_qa_entries` و `knowledge_qa_departments`: پرسش‌وپاسخ‌های رسمی همراه با پرسش‌های جایگزین، کلیدواژه‌ها و محدوده دپارتمان.
- `ai_provider_settings` و `ai_department_settings`: تنظیمات مرکزی ارائه‌دهنده (با `encrypted_api_key`) و سیاست‌های هوشمند هر دپارتمان.
- `ai_conversations`، `ai_messages`، `knowledge_retrieval_records` و `ai_usage_logs`: تاریخچه گفت‌وگوی عمومی و وضعیت انتقال به اپراتور (`waiting_for_operator`)، ردیابی منابع بازیابی‌شده و لاگ مصرف/خطای مدل.

## جداول اضافه‌شده در فاز ۴ (`drizzle/0003_jazzy_squadron_sinister.sql`)
- `customer_profiles`: پروفایل مشتریان با `national_id_hmac` یکتا و `encrypted_national_id` (AES-256-GCM) بدون استفاده از کد ملی به عنوان کلید اصلی.
- `identity_verification_records` و `customer_sessions`: چالش‌های OTP با محدودیت تلاش و نشست‌های مشتری مبتنی بر کوکی `HttpOnly`.
- `department_routing_state`: وضعیت قفل ردیفی (`SELECT ... FOR UPDATE`) و توالی شماره تیکت به ازای هر دپارتمان برای توزیع هم‌زمان و عادلانه.
- `tickets`، `ticket_messages` (`public` / `internal_note`)، `ticket_attachments`، `ticket_assignments`، `ticket_status_history`، `ticket_activity`: چرخه کامل تیکت، تاریخچه مکاتبات از جمله یادداشت‌های محرمانه اپراتورها و پیوست‌های تأییدشده.
- `notifications`: اعلان‌های اختصاص تیکت، پاسخ مشتری و انتقال بین دپارتمانی برای اپراتورها.

## جداول اضافه‌شده در فاز ۵ (`drizzle/0004_grey_mindworm.sql`)
- `file_folders`: ساختار پوشه‌بندی تودرتو دپارتمانی (`parent_folder_id`)، برچسب مالک پوشه و سیاست دسترسی (`department_only` / `shared_read_all_departments`).
- `stored_files`: فراداده فایل‌های اشتراکی، مسیر کلید تصادفی خارج از ریشه وب (`storage_key`)، چک‌سام SHA-256، شماره نسخه، شمارنده دانلود و سیاست دسترسی.
- `file_versions`: تاریخچه نسخه‌های آرشیوشده هنگام جایگزینی امن فایل‌ها.
- `file_permissions`: استثناهای دسترسی دپارتمانی یا کاربری (مشاهده، دانلود، بارگذاری، مدیریت) با اولویت اعمال در سمت سرور.

## بهره‌برداری در فاز ۶ و ۷
- در فاز ۶ از جداول موجود `system_settings` (کلید `platform_general_settings` برای تنظیمات عمومی سامانه) و `audit_logs` به همراه تجمیع‌های تحلیلی روی جداول تیکت، فایل و هوش مصنوعی استفاده شده و نیاز به تغییر یا مهاجرت جدید در ساختار جداول نبوده است.

## اتصال و جداسازی دسترسی
- برنامه در زمان اجرا با کاربر محدود `SQL_USER` (فقط خواندن/نوشتن داده) متصل می‌شود.
- ابزار مهاجرت (`drizzle-kit` و `scripts/migrate.ts`) با کاربر مدیر `SQL_ADMIN_USER` اجرا می‌شود.
