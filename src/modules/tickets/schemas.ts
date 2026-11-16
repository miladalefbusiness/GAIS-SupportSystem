import { z } from 'zod';

export const TICKET_STATUSES = [
  'open',
  'waiting_for_operator',
  'assigned',
  'in_progress',
  'waiting_for_customer',
  'resolved',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUS_LABEL_FA: Record<TicketStatus, string> = {
  open: 'باز',
  waiting_for_operator: 'در انتظار اپراتور',
  assigned: 'تخصیص‌یافته',
  in_progress: 'در حال بررسی',
  waiting_for_customer: 'در انتظار پاسخ مشتری',
  resolved: 'حل‌شده',
  closed: 'بسته‌شده',
};

export const TICKET_PRIORITY_LABEL_FA: Record<TicketPriority, string> = {
  low: 'کم',
  normal: 'عادی',
  high: 'بالا',
  urgent: 'فوری',
};

export const createCustomerTicketSchema = z.object({
  departmentId: z.string().trim().min(3, 'دپارتمان الزامی است.'),
  subject: z
    .string()
    .trim()
    .min(3, 'عنوان تیکت باید حداقل ۳ کاراکتر باشد.')
    .max(160, 'عنوان تیکت بیش از ۱۶۰ کاراکتر است.'),
  description: z
    .string()
    .trim()
    .min(3, 'شرح درخواست باید حداقل ۳ کاراکتر باشد.')
    .max(4000, 'شرح درخواست بیش از ۴۰۰۰ کاراکتر است.'),
  priority: z.enum(TICKET_PRIORITIES).optional().default('normal'),
});

export const convertAiConversationSchema = z.object({
  aiConversationId: z.string().trim().min(5, 'شناسه گفت‌وگو نامعتبر است.'),
  subject: z.string().trim().min(3).max(160).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional().default('normal'),
  reason: z.string().trim().max(400).optional(),
});

export const customerReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'متن پیام نمی‌تواند خالی باشد.')
    .max(4000, 'متن پیام بیش از ۴۰۰۰ کاراکتر است.'),
});

export const operatorReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'متن پیام نمی‌تواند خالی باشد.')
    .max(6000, 'متن پیام بیش از ۶۰۰۰ کاراکتر است.'),
  visibility: z.enum(['public', 'internal_note']).default('public'),
});

export const updateTicketMetaSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  aiAutoReplyEnabled: z.boolean().optional(),
});

export const assignTicketSchema = z.object({
  operatorId: z.string().trim().min(1).nullable(),
  reason: z.string().trim().max(300).optional(),
});

export const transferTicketSchema = z.object({
  targetDepartmentId: z.string().trim().min(3, 'دپارتمان مقصد الزامی است.'),
  operatorId: z.string().trim().min(1).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});
