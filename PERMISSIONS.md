# نظام نقش‌ها و مجوزهای سطح کنش (Permissions & RBAC)

سیاست حاکم بر سامانه **Deny-by-Default** است. هر دسترسی از طریق کلیدهای کنشی در `src/core/auth/permissions-catalog.ts` تعریف می‌شود.

## نقش‌های سیستمی پیش‌فرض (فاز ۱)
- `super_admin` (`مدیر ارشد سامانه`): دارای تمام ۲۲ مجوز کنشی در ۵ ماژول.
- `dept_manager` (`مدیر دپارتمان`): دسترسی به میز پشتیبانی، پاسخگویی، یادداشت داخلی، تخصیص تیکت و فایل‌های دپارتمان.
- `operator` (`اپراتور پشتیبانی`): دسترسی به میز پشتیبانی دپارتمان و فایل‌های مجاز.
- `file_operator` (`اپراتور مخزن فایل`): دسترسی اختصاصی به فضای فایل اشتراکی بدون دسترسی به میز پشتیبانی.
- `viewer` (`کاربر جدید`): بدون مجوز عملیاتی تا زمان تخصیص توسط مدیر ارشد.

## استثناهای فردی (User Permission Overrides)
جدول `user_permission_overrides` امکان اعطای (`allow`) یا سلب (`deny`) یک مجوز خاص را برای کاربر معین فراهم می‌کند. در ارزیابی نهایی، قانون `deny` همیشه بر نقش‌های اعطاشده اولویت دارد.

## مرزبندی دسترسی دپارتمانی (فاز ۲ — Backend-Enforced)
- عضویت اپراتور در دپارتمان‌ها در جدول `department_memberships` با پرچم `is_manager` و سقف تیکت فعال نگهداری می‌شود.
- تابع‌های `canAccessDepartment()` و `canManageDepartment()` و نگهبان API `requireDepartmentAccess()` دسترسی اپراتورها را در سمت سرور کنترل می‌کنند.
- اپراتور عادی صرفاً به دپارتمان‌های تخصیص‌یافته خود دسترسی دارد و درخواست مستقیم به مسیر `/workspace/desk/[departmentId]` یا `/api/workspace/departments/[id]` سایر دپارتمان‌ها با پاسخ `403 Forbidden` مسدود می‌شود (مگر آنکه کاربر نقش `super_admin` یا مجوز `desk:tickets:view_all` داشته باشد).
- مدیر ارشد می‌تواند از `/workspace/admin/roles` نقش‌های سفارشی جدید تعریف کند یا مجوزهای کنشی نقش‌ها را تغییر دهد (مجوزهای کلیدی `super_admin` در برابر حذف محافظت می‌شوند).
- غیرفعال یا تعلیق کردن حساب کاربری یا بازنشانی رمز عبور در سرور، تمام نشست‌های فعال کاربر را در `authentication_sessions` بلافاصله لغو می‌کند و سیستم از غیرفعال‌سازی یا حذف نقش آخرین مدیر ارشد فعال جلوگیری می‌کند.

## مجوزهای مخزن دانش و هوش مصنوعی (فاز ۳)
- `kb:workspace:access`: مشاهده فهرست مجموعه‌ها، اسناد، پرسش‌وپاسخ‌ها و اجرای آزمون بازیابی در `/workspace/admin/knowledge` و دریافت امن فایل (`GET /api/admin/knowledge/documents/[id]/download`).
- `kb:entries:manage`: بارگذاری سند جدید، جایگزینی فایل، پردازش مجدد، فعال/غیرفعال‌سازی، ویرایش و حذف اسناد، مجموعه‌ها و پرسش‌وپاسخ‌ها.
- `ai:settings:manage`: مشاهده تنظیمات ایمن ارائه‌دهنده (بدون کلید رمزگشایی‌شده)، تغییر ارائه‌دهنده/مدل/کلید، اجرای آزمون اتصال (`POST /api/admin/ai/test-connection`) و تنظیم سیاست‌های دپارتمان‌ها.
- `ai:reports:view`: مشاهده گزارش‌های مصرف، خطاهای ارائه‌دهنده و ردیابی منابع بازیابی‌شده در `/workspace/admin/ai-reports`.

## مجوزهای میز پشتیبانی و مخزن فایل اشتراکی (فاز ۴ و ۵)
- `desk:workspace:access`، `desk:tickets:view`، `desk:tickets:view_all`، `desk:tickets:reply`، `desk:tickets:internal_note`، `desk:tickets:assign`، `desk:tickets:transfer`، `desk:tickets:status`
- `files:workspace:access`، `files:items:view`، `files:items:upload`، `files:items:manage_all`، `files:quotas:manage`
- هرگونه عملیات مشاهده یا دانلود فایل در مخزن اشتراکی از طریق `canAccessSharedFile()` و `requireDepartmentAccess()` کنترل می‌شود و مجوزهای صریح (`file_permissions`) تنها به فایل‌های غیرمحدودشده یا استثنای ثبت‌شده اعمال می‌گردند.

## مجوزهای مدیریت ارشد، تنظیمات، گزارش‌ها و ممیزی (فاز ۶ و ۷)
- `admin:settings:manage`: مدیریت تنظیمات عمومی، برندینگ، بنر اطلاعیه و پیش‌فرض‌های سامانه در `/workspace/admin/settings`.
- `admin:audit:view`: مشاهده، جست‌وجو و دریافت خروجی CSV رویدادهای ممیزی در `/workspace/admin/audit` و `/api/admin/reports/export?kind=audit`.
- `admin:panel:access` و `admin:storage:manage`: دسترسی به داشبورد گزارش‌های عملیاتی (`/workspace/admin/reports`) و کنسول زنده سلامت سیستم (`/workspace/admin/health`).

