import { z } from 'zod';

export const createRoleSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]+$/, 'شناسه نقش فقط می‌تواند شامل حروف کوچک انگلیسی، عدد و زیرخط باشد')
    .min(2)
    .max(50),
  nameFa: z.string().trim().min(2, 'نام فارسی نقش الزامی است').max(100),
  descriptionFa: z.string().trim().max(400).default(''),
  permissionIds: z.array(z.string().min(1)).default([]),
});

export const updateRoleSchema = z.object({
  nameFa: z.string().trim().min(2).max(100).optional(),
  descriptionFa: z.string().trim().max(400).optional(),
  permissionIds: z.array(z.string().min(1)).optional(),
});
