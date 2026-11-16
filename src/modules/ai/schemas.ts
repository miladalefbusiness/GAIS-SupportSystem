import { z } from 'zod';

export const aiProviderTypeSchema = z.enum(['gemini', 'openai_compatible']);

export const updateAiProviderSettingsSchema = z.object({
  providerType: aiProviderTypeSchema,
  providerName: z.string().trim().min(2, 'نام ارائه‌دهنده الزامی است').max(80),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  apiKey: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  clearApiKey: z.boolean().optional().default(false),
  chatModel: z.string().trim().min(2, 'نام مدل گفت‌وگو الزامی است').max(120),
  embeddingModel: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  timeoutMs: z.coerce.number().int().min(3000).max(60000).default(25000),
  maxOutputTokens: z.coerce.number().int().min(128).max(8192).default(1024),
  temperature: z
    .string()
    .trim()
    .regex(/^(0(\.\d+)?|1(\.0+)?)$/, 'مقدار دما باید بین ۰ تا ۱ باشد')
    .default('0.1'),
  globalEnabled: z.boolean().default(false),
  rerankerMode: z
    .enum(['none', 'cross_feature', 'llm', 'http_cross_encoder'])
    .optional()
    .default('cross_feature'),
  rerankerEndpointUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  cragMaxIterations: z.coerce.number().int().min(0).max(3).optional().default(2),
  cragMaxModelCalls: z.coerce.number().int().min(0).max(4).optional().default(2),
  cragEnableLlmJudge: z.boolean().optional().default(false),
  enableLlmQueryTransform: z.boolean().optional().default(false),
});

export const updateDepartmentAiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  welcomeMessageFa: z.string().trim().max(1000).default(''),
  fallbackMessageFa: z
    .string()
    .trim()
    .min(10, 'متن پیام عدم یافتن پاسخ الزامی است')
    .max(1000),
  autoOfferEscalation: z.boolean().default(true),
  minConfidenceScore: z.coerce.number().int().min(5).max(95).default(25),
  maxTurnsPerSession: z.coerce.number().int().min(1).max(100).default(20),
  allowAiDuringHumanHandoff: z.boolean().default(false),
  collectionIds: z.array(z.string().min(1)).optional(),
});

export const sendPublicAiMessageSchema = z.object({
  departmentId: z.string().min(1, 'شناسه دپارتمان الزامی است'),
  conversationId: z.string().min(1).optional(),
  message: z
    .string()
    .trim()
    .min(2, 'لطفاً پیام خود را وارد کنید')
    .max(2000, 'طول پیام بیش از حد مجاز است'),
});

export const handoffConversationSchema = z.object({
  departmentId: z.string().min(1).optional(),
  reason: z.string().trim().max(300).optional(),
});
