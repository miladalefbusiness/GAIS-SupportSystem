import { z } from 'zod';

export const kbScopeSchema = z.enum(['global', 'department', 'restricted']);
export const qaStatusSchema = z.enum(['draft', 'published', 'disabled']);

export const createCollectionSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'شناسه انگلیسی فقط می‌تواند شامل حروف کوچک، عدد و خط تیره باشد')
    .min(2)
    .max(64),
  nameFa: z.string().trim().min(2, 'نام فارسی مجموعه الزامی است').max(120),
  descriptionFa: z.string().trim().max(500).default(''),
  scope: kbScopeSchema.default('department'),
  isActive: z.boolean().default(true),
  departmentIds: z.array(z.string().min(1)).default([]),
});

export const updateCollectionSchema = createCollectionSchema.partial();

export const kbClassificationSchema = z.enum([
  'public_org',
  'department',
  'internal_restricted',
]);
export const kbValidityStatusSchema = z.enum(['current', 'superseded', 'expired']);

export const updateDocumentSchema = z.object({
  titleFa: z.string().trim().min(2).max(180).optional(),
  collectionId: z.string().min(1).nullable().optional(),
  scope: kbScopeSchema.optional(),
  classification: kbClassificationSchema.optional(),
  validityStatus: kbValidityStatusSchema.optional(),
  supersededByDocId: z.string().min(1).nullable().optional(),
  isEnabled: z.boolean().optional(),
  departmentIds: z.array(z.string().min(1)).optional(),
});

export const createQaSchema = z.object({
  collectionId: z.string().min(1).nullable().optional(),
  question: z.string().trim().min(3, 'متن پرسش الزامی است').max(500),
  alternativeQuestions: z.array(z.string().trim().min(2).max(500)).max(20).default([]),
  officialAnswer: z.string().trim().min(3, 'متن پاسخ رسمی الزامی است').max(8000),
  category: z.string().trim().min(1).max(80).default('عمومی'),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  scope: kbScopeSchema.default('department'),
  status: qaStatusSchema.default('published'),
  departmentIds: z.array(z.string().min(1)).default([]),
});

export const updateQaSchema = createQaSchema.partial();

export const testRetrievalSchema = z.object({
  departmentId: z.string().min(1, 'انتخاب دپارتمان الزامی است'),
  query: z.string().trim().min(2, 'متن پرسش آزمایشی الزامی است').max(1000),
  forcedStrategy: z
    .enum([
      'direct_lexical',
      'semantic',
      'hybrid',
      'multi_query',
      'decomposed',
      'iterative',
    ])
    .nullable()
    .optional(),
  rerankerMode: z.enum(['none', 'cross_feature', 'llm']).optional(),
});
