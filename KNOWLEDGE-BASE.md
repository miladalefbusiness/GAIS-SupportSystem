# معماری مخزن دانش (Knowledge Base — پیاده‌سازی‌شده در فاز ۳)

> **وضعیت فعلی**: در **فاز ۳** به صورت کامل پیاده‌سازی و فعال شده است.

## قابلیت‌های پیاده‌سازی‌شده
- **ورود دوگانه دانش (`src/modules/knowledge/service.ts` و `/workspace/admin/knowledge`)**:
  1. بارگذاری اسناد سازمانی (`PDF` با `unpdf`، `DOCX` با `mammoth`، `TXT` و `Markdown`) با بررسی امضای بایت واقعی (`%PDF-`، `PK\x03\x04`، متن بدون NUL) و چرخه وضعیت شفاف (`processing` → `indexed` / `failed` / `disabled`)، همراه با نسخه‌بندی (`knowledge_document_versions`)، جایگزینی فایل، پردازش مجدد و دانلود امن (`X-Content-Type-Options: nosniff`).
  2. ویرایشگر گرافیکی پرسش و پاسخ (`Q&A`) با پشتیبانی از چندین پرسش جایگزین، کلیدواژه‌ها، دسته‌بندی و وضعیت انتشار (`published` / `draft` / `disabled`).
- **نرمال‌سازی فارسی و قطعه‌بندی (`src/modules/knowledge/text.ts`)**: یکسان‌سازی حروف عربی/فارسی (`ي/ك` ← `ی/ک`) و ارقام، حذف اعراب، و قطعه‌بندی با همپوشانی (Overlap).
- **مجموعه‌ها و کنترل دسترسی دپارتمانی (`src/modules/knowledge/retrieval.ts`)**:
  - سطوح `global` (سراسری)، `department` (متصل به دپارتمان‌های مشخص یا مجموعه‌های دپارتمان) و `restricted` (محرمانه، هرگز توسط AI بازیابی نمی‌شود).
  - فیلتر مجوز دپارتمان در SQL پیش از رتبه‌بندی و ارسال به مدل، تشخیص تعارض عددی یا اسناد منسوخ (`detectKnowledgeConflict`)، و ثبت ردیابی منبع (`knowledge_retrieval_records`).
- **آزمایشگر بازیابی (Retrieval Sandbox)**: مسیر `POST /api/admin/knowledge/test-retrieval` برای بررسی زنده امتیازها و تطبیق منابع در هر دپارتمان.
