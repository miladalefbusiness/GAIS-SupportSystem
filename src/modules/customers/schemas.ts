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
