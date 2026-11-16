import { z } from 'zod';

export const PLATFORM_SETTINGS_KEY = 'platform_general_settings';

export const THEME_ACCENT_OPTIONS = ['blue', 'indigo', 'emerald', 'slate'] as const;
export type ThemeAccentPreset = (typeof THEME_ACCENT_OPTIONS)[number];

export const platformSettingsSchema = z.object({
  siteTitleFa: z
    .string()
    .trim()
    .min(2, 'عنوان سامانه باید حداقل ۲ کاراکتر باشد.')
    .max(120, 'عنوان سامانه بسیار طولانی است.'),
  brandNameFa: z
    .string()
    .trim()
    .min(2, 'نام کوتاه برند باید حداقل ۲ کاراکتر باشد.')
    .max(60, 'نام کوتاه برند بسیار طولانی است.'),
  heroTitleFa: z
    .string()
    .trim()
    .min(4, 'تیتر اصلی صفحه عمومی الزامی است.')
    .max(180, 'تیتر اصلی بسیار طولانی است.'),
  heroDescriptionFa: z
    .string()
    .trim()
    .min(10, 'توضیحات صفحه عمومی الزامی است.')
    .max(500, 'توضیحات صفحه عمومی بسیار طولانی است.'),
  supportContactText: z
    .string()
    .trim()
    .max(200, 'اطلاعات تماس پشتیبانی بسیار طولانی است.')
    .default('پاسخگویی همه‌روزه از طریق دپارتمان‌های پشتیبانی'),
  maintenanceNoticeFa: z
    .string()
    .trim()
    .max(300, 'متن اطلاعیه نباید بیش از ۳۰۰ کاراکتر باشد.')
    .default(''),
  defaultTicketPriority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  customerOtpTtlMinutes: z.coerce
    .number()
    .int()
    .min(2, 'حداقل اعتبار کد تأیید ۲ دقیقه است.')
    .max(30, 'حداکثر اعتبار کد تأیید ۳۰ دقیقه است.')
    .default(5),
  showWorkspacesSummary: z.boolean().default(true),
  themeAccent: z.enum(THEME_ACCENT_OPTIONS).default('blue'),
});

export type PlatformSettingsDto = z.infer<typeof platformSettingsSchema>;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsDto = {
  siteTitleFa: 'پورتال پشتیبانی آنلاین و پیگیری درخواست‌ها',
  brandNameFa: 'مرکز پشتیبانی',
  heroTitleFa: 'پشتیبانی تخصصی دپارتمان‌ها و گفت‌وگوی آنلاین',
  heroDescriptionFa:
    'دپارتمان مرتبط با درخواست خود را انتخاب کنید تا بلافاصله گفت‌وگو با دستیار هوشمند یا کارشناس پشتیبانی را آغاز کنید و در صورت نیاز تیکت رسمی ثبت نمایید.',
  supportContactText: 'پاسخگویی سریع آنلاین همه‌روزه از طریق دپارتمان‌های تخصصی',
  maintenanceNoticeFa: '',
  defaultTicketPriority: 'normal',
  customerOtpTtlMinutes: 5,
  showWorkspacesSummary: true,
  themeAccent: 'blue',
};
