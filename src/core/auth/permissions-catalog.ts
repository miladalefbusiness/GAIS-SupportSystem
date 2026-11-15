export type PermissionModule =
  | 'support_desk'
  | 'shared_files'
  | 'knowledge_base'
  | 'ai_settings'
  | 'administration';

export interface PermissionDefinition {
  id: string;
  key: string;
  module: PermissionModule;
  nameFa: string;
  descriptionFa: string;
}

export interface RoleDefinition {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  isSystem: boolean;
  permissionKeys: string[];
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // Support Desk
  {
    id: 'perm_desk_workspace',
    key: 'desk:workspace:access',
    module: 'support_desk',
    nameFa: 'دسترسی به فضای میز پشتیبانی',
    descriptionFa: 'ورود به محیط کار اپراتورهای پشتیبانی',
  },
  {
    id: 'perm_desk_tickets_dept',
    key: 'desk:tickets:view_department',
    module: 'support_desk',
    nameFa: 'مشاهده تیکت‌های دپارتمان',
    descriptionFa: 'مشاهده تیکت‌های دپارتمان‌های مجاز کاربر',
  },
  {
    id: 'perm_desk_tickets_all',
    key: 'desk:tickets:view_all',
    module: 'support_desk',
    nameFa: 'مشاهده تمام تیکت‌ها',
    descriptionFa: 'مشاهده تیکت‌های تمام دپارتمان‌های سازمان',
  },
  {
    id: 'perm_desk_tickets_reply',
    key: 'desk:tickets:reply',
    module: 'support_desk',
    nameFa: 'پاسخ به تیکت‌ها',
    descriptionFa: 'ارسال پاسخ رسمی به مراجعین در تیکت‌ها',
  },
  {
    id: 'perm_desk_tickets_notes',
    key: 'desk:tickets:internal_notes',
    module: 'support_desk',
    nameFa: 'ثبت یادداشت داخلی',
    descriptionFa: 'افزودن یادداشت داخلی غیرقابل مشاهده برای مشتری',
  },
  {
    id: 'perm_desk_tickets_assign',
    key: 'desk:tickets:assign',
    module: 'support_desk',
    nameFa: 'تخصیص و ارجاع تیکت',
    descriptionFa: 'تخصیص تیکت به اپراتورها یا انتقال بین دپارتمان‌ها',
  },

  // Shared Files
  {
    id: 'perm_files_workspace',
    key: 'files:workspace:access',
    module: 'shared_files',
    nameFa: 'دسترسی به مخزن فایل اشتراکی',
    descriptionFa: 'ورود به فضای کتابخانه فایل سازمانی',
  },
  {
    id: 'perm_files_view',
    key: 'files:items:view',
    module: 'shared_files',
    nameFa: 'مشاهده و دانلود فایل‌ها',
    descriptionFa: 'مشاهده فهرست و دریافت فایل‌های مجاز',
  },
  {
    id: 'perm_files_upload',
    key: 'files:items:upload',
    module: 'shared_files',
    nameFa: 'بارگذاری و مدیریت پوشه دپارتمان',
    descriptionFa: 'ایجاد پوشه و بارگذاری فایل در دپارتمان مجاز',
  },
  {
    id: 'perm_files_manage_all',
    key: 'files:items:manage_all',
    module: 'shared_files',
    nameFa: 'مدیریت فایل‌های تمام دپارتمان‌ها',
    descriptionFa: 'ویرایش، جایگزینی و حذف فایل‌ها در کل سازمان',
  },
  {
    id: 'perm_files_quotas',
    key: 'files:quotas:manage',
    module: 'shared_files',
    nameFa: 'مدیریت سهمیه‌های ذخیره‌سازی',
    descriptionFa: 'تعیین سقف حجم ذخیره‌سازی سازمان و دپارتمان‌ها',
  },

  // Knowledge Base
  {
    id: 'perm_kb_access',
    key: 'kb:workspace:access',
    module: 'knowledge_base',
    nameFa: 'دسترسی به مخزن دانش',
    descriptionFa: 'مشاهده مجموعه اسناد و پرسش‌وپاسخ‌های سازمانی',
  },
  {
    id: 'perm_kb_manage',
    key: 'kb:entries:manage',
    module: 'knowledge_base',
    nameFa: 'مدیریت اسناد و پرسش‌وپاسخ‌ها',
    descriptionFa: 'بارگذاری سند، پردازش مجدد و انتشار پرسش‌وپاسخ',
  },

  // AI Settings
  {
    id: 'perm_ai_settings',
    key: 'ai:settings:manage',
    module: 'ai_settings',
    nameFa: 'پیکربندی ارائه‌دهنده هوش مصنوعی',
    descriptionFa: 'تنظیم مدل، آدرس API، کلید و آزمون اتصال',
  },
  {
    id: 'perm_ai_reports',
    key: 'ai:reports:view',
    module: 'ai_settings',
    nameFa: 'مشاهده گزارش‌های مصرف هوش مصنوعی',
    descriptionFa: 'بررسی آمار پاسخگویی و مصرف مدل‌های هوش مصنوعی',
  },

  // Administration
  {
    id: 'perm_admin_panel',
    key: 'admin:panel:access',
    module: 'administration',
    nameFa: 'دسترسی به پنل مدیریت ارشد',
    descriptionFa: 'ورود به بخش تنظیمات و کنترل کل سامانه',
  },
  {
    id: 'perm_admin_users',
    key: 'admin:users:manage',
    module: 'administration',
    nameFa: 'مدیریت کاربران و اپراتورها',
    descriptionFa: 'ایجاد، ویرایش، تعلیق و بازنشانی حساب کاربری اپراتورها',
  },
  {
    id: 'perm_admin_departments',
    key: 'admin:departments:manage',
    module: 'administration',
    nameFa: 'مدیریت دپارتمان‌ها',
    descriptionFa: 'ساخت، فعال‌سازی و تنظیم قوانین دپارتمان‌ها',
  },
  {
    id: 'perm_admin_roles',
    key: 'admin:roles:manage',
    module: 'administration',
    nameFa: 'مدیریت نقش‌ها و دسترسی‌ها',
    descriptionFa: 'تعریف نقش‌ها و تخصیص دسترسی‌های سطح کنش',
  },
  {
    id: 'perm_admin_settings',
    key: 'admin:settings:manage',
    module: 'administration',
    nameFa: 'مدیریت تنظیمات سامانه',
    descriptionFa: 'پیکربندی تنظیمات عمومی، امنیتی و ظاهری سامانه',
  },
  {
    id: 'perm_admin_storage',
    key: 'admin:storage:manage',
    module: 'administration',
    nameFa: 'مدیریت وضعیت ذخیره‌سازی',
    descriptionFa: 'مشاهده ظرفیت دیسک، درایور ذخیره‌سازی و سلامت مخزن',
  },
  {
    id: 'perm_admin_audit',
    key: 'admin:audit:view',
    module: 'administration',
    nameFa: 'مشاهده گزارش‌های ممیزی امنیتی',
    descriptionFa: 'بررسی رویدادهای احراز هویت و تغییرات مدیریتی',
  },
];

export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    id: 'role_super_admin',
    slug: 'super_admin',
    nameFa: 'مدیر ارشد سامانه',
    descriptionFa: 'دسترسی کامل به تمامی بخش‌های پشتیبانی، مخزن فایل، مخزن دانش، هوش مصنوعی و مدیریت سامانه',
    isSystem: true,
    permissionKeys: PERMISSION_CATALOG.map((p) => p.key),
  },
  {
    id: 'role_dept_manager',
    slug: 'dept_manager',
    nameFa: 'مدیر دپارتمان',
    descriptionFa: 'مدیریت تیکت‌ها، اپراتورهای دپارتمان و فایل‌های دپارتمان مجاز',
    isSystem: true,
    permissionKeys: [
      'desk:workspace:access',
      'desk:tickets:view_department',
      'desk:tickets:reply',
      'desk:tickets:internal_notes',
      'desk:tickets:assign',
      'files:workspace:access',
      'files:items:view',
      'files:items:upload',
      'kb:workspace:access',
    ],
  },
  {
    id: 'role_operator',
    slug: 'operator',
    nameFa: 'اپراتور پشتیبانی',
    descriptionFa: 'پاسخگویی به تیکت‌های دپارتمان مجاز و دسترسی پایه به مخزن فایل',
    isSystem: true,
    permissionKeys: [
      'desk:workspace:access',
      'desk:tickets:view_department',
      'desk:tickets:reply',
      'desk:tickets:internal_notes',
      'files:workspace:access',
      'files:items:view',
      'files:items:upload',
    ],
  },
  {
    id: 'role_file_operator',
    slug: 'file_operator',
    nameFa: 'اپراتور مخزن فایل',
    descriptionFa: 'دسترسی اختصاصی به فضای مخزن فایل اشتراکی بدون دسترسی به میز پشتیبانی',
    isSystem: true,
    permissionKeys: [
      'files:workspace:access',
      'files:items:view',
      'files:items:upload',
    ],
  },
  {
    id: 'role_viewer',
    slug: 'viewer',
    nameFa: 'کاربر جدید (در انتظار تخصیص)',
    descriptionFa: 'حساب تاییدشده بدون دسترسی عملیاتی تا زمان تخصیص نقش توسط مدیر ارشد',
    isSystem: true,
    permissionKeys: [],
  },
];

export interface PermissionOverrideInput {
  permissionKey: string;
  effect: 'allow' | 'deny';
}

export function resolveEffectivePermissions(
  rolePermissionKeys: string[],
  overrides: PermissionOverrideInput[]
): string[] {
  const effective = new Set<string>(rolePermissionKeys);
  for (const override of overrides) {
    if (override.effect === 'allow') {
      effective.add(override.permissionKey);
    }
  }
  for (const override of overrides) {
    if (override.effect === 'deny') {
      effective.delete(override.permissionKey);
    }
  }
  return Array.from(effective).sort();
}
