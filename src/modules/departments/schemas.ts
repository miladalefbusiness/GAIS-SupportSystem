import { z } from 'zod';
import { DEPARTMENT_ICON_OPTIONS } from './icons.ts';

const iconKeys = DEPARTMENT_ICON_OPTIONS.map((i) => i.key) as [
  (typeof DEPARTMENT_ICON_OPTIONS)[number]['key'],
  ...(typeof DEPARTMENT_ICON_OPTIONS)[number]['key'][]
];

export const assignmentStrategySchema = z.enum([
  'round_robin',
  'least_loaded',
  'manual_queue',
]);

export const createDepartmentSchema = z.object({
  nameFa: z.string().trim().min(2, 'نام دپارتمان باید حداقل ۲ کاراکتر باشد').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'شناسه انگلیسی (slug) فقط می‌تواند شامل حروف کوچک، اعداد و خط تیره باشد')
    .min(2)
    .max(64),
  descriptionFa: z.string().trim().max(500).default(''),
  iconKey: z.enum(iconKeys).default('building'),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  aiEnabled: z.boolean().default(true),
  humanOperatorsAvailable: z.boolean().default(true),
  assignmentStrategy: assignmentStrategySchema.default('round_robin'),
  welcomeMessageFa: z.string().trim().max(1000).default(''),
  maxUploadSizeMb: z.coerce.number().int().min(1).max(200).default(10),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const updateDepartmentMembersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        isManager: z.boolean().default(false),
        isAvailable: z.boolean().default(true),
        maxActiveTickets: z.coerce.number().int().min(1).max(200).default(15),
      })
    )
    .max(500),
});
