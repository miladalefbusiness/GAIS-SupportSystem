import { z } from 'zod';

export const requestCustomerOtpSchema = z.object({
  nationalId: z
    .string()
    .trim()
    .min(10, 'کد ملی باید ۱۰ رقم باشد.')
    .max(20, 'کد ملی نامعتبر است.'),
  fullName: z
    .string()
    .trim()
    .min(2, 'نام و نام خانوادگی حداقل ۲ کاراکتر است.')
    .max(120, 'نام و نام خانوادگی بیش از حد طولانی است.'),
  phone: z.string().trim().max(24).optional().nullable(),
  purpose: z
    .enum(['customer_portal', 'ticket_create', 'ticket_handoff'])
    .optional()
    .default('customer_portal'),
});

export const verifyCustomerOtpSchema = z.object({
  challengeId: z.string().trim().min(6, 'شناسه چالش نامعتبر است.').max(120),
  otpCode: z.string().trim().min(4, 'کد تأیید نامعتبر است.').max(12),
});

export const customerIdentitySchema = z.object({
  nationalId: z
    .string()
    .trim()
    .min(10, 'کد ملی باید ۱۰ رقم باشد.')
    .max(20, 'کد ملی نامعتبر است.'),
  fullName: z
    .string()
    .trim()
    .min(2, 'نام و نام خانوادگی حداقل ۲ کاراکتر است.')
    .max(120, 'نام و نام خانوادگی بیش از حد طولانی است.'),
  phone: z.string().trim().max(24).optional().nullable(),
});

export const customerPasswordAuthSchema = z.object({
  nationalId: z
    .string()
    .trim()
    .min(10, 'کد ملی باید ۱۰ رقم باشد.')
    .max(20, 'کد ملی نامعتبر است.'),
  password: z
    .string()
    .min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد.')
    .max(128, 'رمز عبور بیش از حد طولانی است.'),
  fullName: z
    .string()
    .trim()
    .min(2, 'نام و نام خانوادگی حداقل ۲ کاراکتر است.')
    .max(120, 'نام و نام خانوادگی بیش از حد طولانی است.')
    .optional(),
  phone: z.string().trim().max(24).optional().nullable(),
  mode: z.enum(['auto', 'login', 'set_password']).optional().default('auto'),
});

export const adminUpdateSystemUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'نام و نام خانوادگی حداقل ۲ کاراکتر است.')
    .max(120, 'نام و نام خانوادگی بیش از حد طولانی است.')
    .optional(),
  phone: z.string().trim().max(24).optional().nullable(),
  newPassword: z
    .string()
    .min(6, 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد.')
    .max(128, 'رمز عبور بیش از حد طولانی است.')
    .optional(),
});
