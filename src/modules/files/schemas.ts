import { z } from 'zod';

export const SHARED_FILE_EXTENSION_CATALOG = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'md',
  'csv',
] as const;

export type SupportedSharedFileExtension =
  (typeof SHARED_FILE_EXTENSION_CATALOG)[number];

export const FOLDER_ACCESS_POLICIES = [
  'department_only',
  'shared_read_all_departments',
] as const;

export const FILE_ACCESS_POLICIES = [
  'inherit',
  'department_only',
  'shared_read_all_departments',
] as const;

export const createFolderSchema = z.object({
  departmentId: z.string().min(1, 'انتخاب دپارتمان الزامی است.'),
  parentFolderId: z.string().min(1).nullable().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'نام پوشه الزامی است.')
    .max(120, 'نام پوشه نمی‌تواند بیش از ۱۲۰ کاراکتر باشد.'),
  description: z.string().trim().max(500).optional().default(''),
  ownerLabel: z.string().trim().max(120).nullable().optional(),
  accessPolicy: z.enum(FOLDER_ACCESS_POLICIES).optional().default('department_only'),
});

export const updateFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'نام پوشه الزامی است.')
    .max(120, 'نام پوشه نمی‌تواند بیش از ۱۲۰ کاراکتر باشد.')
    .optional(),
  description: z.string().trim().max(500).optional(),
  ownerLabel: z.string().trim().max(120).nullable().optional(),
  accessPolicy: z.enum(FOLDER_ACCESS_POLICIES).optional(),
});

export const updateFileSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'عنوان فایل نمی‌تواند خالی باشد.')
    .max(180, 'عنوان فایل بسیار طولانی است.')
    .optional(),
  description: z.string().trim().max(1000).optional(),
  folderId: z.string().min(1).nullable().optional(),
  accessPolicy: z.enum(FILE_ACCESS_POLICIES).optional(),
});

export const upsertQuotaSchema = z.object({
  scopeType: z.enum(['global', 'department', 'operator']),
  scopeId: z.string().min(1, 'شناسه هدف سهمیه الزامی است.'),
  maxMb: z.coerce
    .number()
    .min(1, 'حداقل سهمیه ۱ مگابایت است.')
    .max(1024 * 1024, 'مقدار سهمیه بیش از حد مجاز است.'),
});

export const updateFileHubPolicySchema = z.object({
  allowedExtensions: z
    .array(z.enum(SHARED_FILE_EXTENSION_CATALOG))
    .min(1, 'حداقل یک پسوند مجاز باید انتخاب شود.'),
  maxUploadSizeMb: z.coerce
    .number()
    .int()
    .min(1, 'حداقل سقف حجم بارگذاری ۱ مگابایت است.')
    .max(250, 'حداکثر سقف حجم بارگذاری ۲۵۰ مگابایت است.'),
});

export const grantFilePermissionSchema = z.object({
  departmentId: z.string().min(1, 'انتخاب دپارتمان الزامی است.'),
  folderId: z.string().min(1).nullable().optional(),
  fileId: z.string().min(1).nullable().optional(),
  targetType: z.enum(['user', 'department']),
  targetId: z.string().min(1, 'انتخاب کاربر یا دپارتمان هدف الزامی است.'),
  canView: z.boolean().default(true),
  canDownload: z.boolean().default(true),
  canUpload: z.boolean().default(false),
  canManage: z.boolean().default(false),
  note: z.string().trim().max(300).nullable().optional(),
});
