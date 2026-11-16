export const DEPARTMENT_ICON_OPTIONS = [
  { key: 'building', labelFa: 'ساختمان سازمانی' },
  { key: 'graduation-cap', labelFa: 'آموزش و دوره‌ها' },
  { key: 'users', labelFa: 'امور عضویت' },
  { key: 'wallet', labelFa: 'امور مالی' },
  { key: 'wrench', labelFa: 'پشتیبانی فنی' },
  { key: 'shield', labelFa: 'حراست و امنیت' },
  { key: 'headset', labelFa: 'پاسخگویی عمومی' },
  { key: 'file-text', labelFa: 'امور اداری و اسناد' },
  { key: 'briefcase', labelFa: 'منابع انسانی' },
  { key: 'globe', labelFa: 'امور بین‌الملل' },
] as const;

export type DepartmentIconKey = (typeof DEPARTMENT_ICON_OPTIONS)[number]['key'];
