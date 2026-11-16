import { z } from 'zod';

export const operatorStatusSchema = z.enum(['active', 'inactive', 'suspended']);

export const createOperatorSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]+$/, 'نام کاربری فقط می‌تواند شامل حروف لاتین، اعداد، نقطه و زیرخط باشد')
    .min(3, 'نام کاربری حداقل ۳ کاراکتر است')
    .max(50),
  email: z.string().trim().toLowerCase().email('نشانی ایمیل معتبر نیست'),
  name: z.string().trim().min(2, 'نام و نام خانوادگی الزامی است').max(120),
  password: z
    .string()
    .min(10, 'رمز عبور باید حداقل ۱۰ کاراکتر باشد')
    .max(128)
    .regex(/[A-Za-z]/, 'رمز عبور باید شامل حروف لاتین باشد')
    .regex(/[0-9]/, 'رمز عبور باید شامل حداقل یک عدد باشد'),
  mustChangePassword: z.boolean().default(true),
  isAvailable: z.boolean().default(true),
  roleIds: z.array(z.string().min(1)).min(1, 'حداقل یک نقش باید انتخاب شود'),
  departments: z
    .array(
      z.object({
        departmentId: z.string().min(1),
        isManager: z.boolean().default(false),
        maxActiveTickets: z.coerce.number().int().min(1).max(200).default(15),
      })
    )
    .default([]),
});

export const updateOperatorSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  status: operatorStatusSchema.optional(),
  isAvailable: z.boolean().optional(),
  availabilityNote: z.string().trim().max(250).nullable().optional(),
  roleIds: z.array(z.string().min(1)).min(1).optional(),
  departments: z
    .array(
      z.object({
        departmentId: z.string().min(1),
        isManager: z.boolean().default(false),
        isAvailable: z.boolean().default(true),
        maxActiveTickets: z.coerce.number().int().min(1).max(200).default(15),
      })
    )
    .optional(),
  resetPassword: z
    .string()
    .min(10, 'رمز عبور جدید باید حداقل ۱۰ کاراکتر باشد')
    .max(128)
    .regex(/[A-Za-z]/, 'رمز عبور باید شامل حروف لاتین باشد')
    .regex(/[0-9]/, 'رمز عبور باید شامل حداقل یک عدد باشد')
    .optional(),
});

export const updateOperatorPermissionsSchema = z.object({
  overrides: z
    .array(
      z.object({
        permissionId: z.string().min(1),
        effect: z.enum(['allow', 'deny']),
        reason: z.string().trim().max(300).optional(),
      })
    )
    .max(200),
});
