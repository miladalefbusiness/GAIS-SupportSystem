import { eq } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '@/src/core/security/crypto.ts';
import { db } from '@/src/db/index.ts';
import {
  aiDepartmentSettings,
  aiProviderSettings,
  departmentKnowledgeCollections,
  departments,
  knowledgeCollections,
} from '@/src/db/schema.ts';

export const DEFAULT_FALLBACK_MESSAGE_FA =
  'برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.';

function getAiKeyEncryptionMaterial(): string {
  const envKey = process.env.APP_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) return envKey;
  if (process.env.NODE_ENV === 'production') {
    if (process.env.K_SERVICE && process.env.SQL_PASSWORD) {
      return `cr-ai-${process.env.SQL_PASSWORD}-${process.env.APPLET_ID || 'supportdesk'}`;
    }
    throw new Error('APP_ENCRYPTION_KEY must be configured in production.');
  }
  return 'dev-only-ai-encryption-secret-material-32bytes';
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export interface SafeAiProviderView {
  providerType: 'gemini' | 'openai_compatible';
  providerName: string;
  baseUrl: string | null;
  hasStoredApiKey: boolean;
  hasEnvGeminiKey: boolean;
  apiKeyHint: string | null;
  chatModel: string;
  embeddingModel: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: string;
  globalEnabled: boolean;
  rerankerMode: 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder';
  rerankerEndpointUrl: string | null;
  cragMaxIterations: number;
  cragMaxModelCalls: number;
  cragEnableLlmJudge: boolean;
  enableLlmQueryTransform: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface InternalAiProviderRuntimeConfig {
  providerType: 'gemini' | 'openai_compatible';
  providerName: string;
  baseUrl: string | null;
  apiKey: string | null;
  chatModel: string;
  embeddingModel: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
  globalEnabled: boolean;
  rerankerMode?: 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder';
  rerankerEndpointUrl?: string | null;
  cragMaxIterations?: number;
  cragMaxModelCalls?: number;
  cragEnableLlmJudge?: boolean;
  enableLlmQueryTransform?: boolean;
}

function normalizeRerankerMode(
  raw: string | null | undefined
): 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder' {
  if (
    raw === 'none' ||
    raw === 'cross_feature' ||
    raw === 'llm' ||
    raw === 'http_cross_encoder'
  ) {
    return raw;
  }
  return 'cross_feature';
}

export async function getSafeAiProviderSettings(): Promise<SafeAiProviderView> {
  const row = await db.query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.id, 'default'),
  });

  const hasEnvGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (!row) {
    const bootstrapBaseUrl = process.env.AI_BASE_URL?.trim() || null;
    const bootstrapModel =
      process.env.AI_CHAT_MODEL?.trim() ||
      (bootstrapBaseUrl ? 'gpt-4o-mini' : 'gemini-4-hydrogen');
    return {
      providerType: bootstrapBaseUrl ? 'openai_compatible' : 'gemini',
      providerName: bootstrapBaseUrl ? 'OpenAI-Compatible API' : 'Google Gemini',
      baseUrl: bootstrapBaseUrl,
      hasStoredApiKey: Boolean(process.env.AI_API_KEY?.trim()),
      hasEnvGeminiKey,
      apiKeyHint: process.env.AI_API_KEY?.trim()
        ? maskApiKey(process.env.AI_API_KEY.trim())
        : null,
      chatModel: bootstrapModel,
      embeddingModel: process.env.AI_EMBEDDING_MODEL?.trim() || null,
      timeoutMs: 25000,
      maxOutputTokens: 1024,
      temperature: '0.1',
      globalEnabled: hasEnvGeminiKey || Boolean(process.env.AI_API_KEY?.trim()),
      rerankerMode: 'cross_feature',
      rerankerEndpointUrl: null,
      cragMaxIterations: 2,
      cragMaxModelCalls: 2,
      cragEnableLlmJudge: false,
      enableLlmQueryTransform: false,
      lastTestedAt: null,
      lastTestOk: null,
      lastTestMessage: null,
    };
  }

  return {
    providerType:
      row.providerType === 'openai_compatible' ? 'openai_compatible' : 'gemini',
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    hasStoredApiKey: Boolean(row.encryptedApiKey),
    hasEnvGeminiKey,
    apiKeyHint: row.apiKeyHint,
    chatModel: row.chatModel,
    embeddingModel: row.embeddingModel,
    timeoutMs: row.timeoutMs,
    maxOutputTokens: row.maxOutputTokens,
    temperature: row.temperature,
    globalEnabled: row.globalEnabled,
    rerankerMode: normalizeRerankerMode(row.rerankerMode),
    rerankerEndpointUrl: row.rerankerEndpointUrl ?? null,
    cragMaxIterations: row.cragMaxIterations ?? 2,
    cragMaxModelCalls: row.cragMaxModelCalls ?? 2,
    cragEnableLlmJudge: row.cragEnableLlmJudge ?? false,
    enableLlmQueryTransform: row.enableLlmQueryTransform ?? false,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
  };
}

export async function getInternalAiProviderRuntimeConfig(): Promise<InternalAiProviderRuntimeConfig> {
  const row = await db.query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.id, 'default'),
  });

  if (!row) {
    const bootstrapBaseUrl = process.env.AI_BASE_URL?.trim() || null;
    const bootstrapKey =
      process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
    return {
      providerType: bootstrapBaseUrl ? 'openai_compatible' : 'gemini',
      providerName: bootstrapBaseUrl ? 'OpenAI-Compatible API' : 'Google Gemini',
      baseUrl: bootstrapBaseUrl,
      apiKey: bootstrapKey,
      chatModel:
        process.env.AI_CHAT_MODEL?.trim() ||
        (bootstrapBaseUrl ? 'gpt-4o-mini' : 'gemini-4-hydrogen'),
      embeddingModel: process.env.AI_EMBEDDING_MODEL?.trim() || null,
      timeoutMs: 25000,
      maxOutputTokens: 1024,
      temperature: 0.1,
      globalEnabled: Boolean(bootstrapKey),
      rerankerMode: 'cross_feature',
      rerankerEndpointUrl: null,
      cragMaxIterations: 2,
      cragMaxModelCalls: 2,
      cragEnableLlmJudge: false,
      enableLlmQueryTransform: false,
    };
  }

  let decryptedKey: string | null = null;
  if (row.encryptedApiKey) {
    decryptedKey = decryptSensitiveValue(
      row.encryptedApiKey,
      getAiKeyEncryptionMaterial()
    );
  } else if (row.providerType === 'gemini') {
    decryptedKey = process.env.GEMINI_API_KEY?.trim() || null;
  } else {
    decryptedKey = process.env.AI_API_KEY?.trim() || null;
  }

  const parsedTemp = Number(row.temperature);
  return {
    providerType:
      row.providerType === 'openai_compatible' ? 'openai_compatible' : 'gemini',
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    apiKey: decryptedKey,
    chatModel: row.chatModel,
    embeddingModel: row.embeddingModel,
    timeoutMs: row.timeoutMs,
    maxOutputTokens: row.maxOutputTokens,
    temperature: Number.isFinite(parsedTemp) ? parsedTemp : 0.1,
    globalEnabled: row.globalEnabled,
    rerankerMode: normalizeRerankerMode(row.rerankerMode),
    rerankerEndpointUrl: row.rerankerEndpointUrl ?? null,
    cragMaxIterations: row.cragMaxIterations ?? 2,
    cragMaxModelCalls: row.cragMaxModelCalls ?? 2,
    cragEnableLlmJudge: row.cragEnableLlmJudge ?? false,
    enableLlmQueryTransform: row.enableLlmQueryTransform ?? false,
  };
}

export async function upsertAiProviderSettings(params: {
  input: {
    providerType: 'gemini' | 'openai_compatible';
    providerName: string;
    baseUrl?: string | null;
    apiKey?: string;
    clearApiKey?: boolean;
    chatModel: string;
    embeddingModel?: string | null;
    timeoutMs: number;
    maxOutputTokens: number;
    temperature: string;
    globalEnabled: boolean;
    rerankerMode?: 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder';
    rerankerEndpointUrl?: string | null;
    cragMaxIterations?: number;
    cragMaxModelCalls?: number;
    cragEnableLlmJudge?: boolean;
    enableLlmQueryTransform?: boolean;
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.id, 'default'),
  });

  if (
    params.input.providerType === 'openai_compatible' &&
    !params.input.baseUrl
  ) {
    throw new Error('BASE_URL_REQUIRED');
  }

  let encryptedApiKey = existing?.encryptedApiKey ?? null;
  let apiKeyHint = existing?.apiKeyHint ?? null;

  if (params.input.clearApiKey) {
    encryptedApiKey = null;
    apiKeyHint = null;
  } else if (params.input.apiKey) {
    encryptedApiKey = encryptSensitiveValue(
      params.input.apiKey,
      getAiKeyEncryptionMaterial()
    );
    apiKeyHint = maskApiKey(params.input.apiKey);
  }

  const rerankerMode = params.input.rerankerMode ?? existing?.rerankerMode ?? 'cross_feature';
  const rerankerEndpointUrl =
    params.input.rerankerEndpointUrl !== undefined
      ? params.input.rerankerEndpointUrl
      : existing?.rerankerEndpointUrl ?? null;
  const cragMaxIterations =
    params.input.cragMaxIterations ?? existing?.cragMaxIterations ?? 2;
  const cragMaxModelCalls =
    params.input.cragMaxModelCalls ?? existing?.cragMaxModelCalls ?? 2;
  const cragEnableLlmJudge =
    params.input.cragEnableLlmJudge ?? existing?.cragEnableLlmJudge ?? false;
  const enableLlmQueryTransform =
    params.input.enableLlmQueryTransform ?? existing?.enableLlmQueryTransform ?? false;

  await db
    .insert(aiProviderSettings)
    .values({
      id: 'default',
      providerType: params.input.providerType,
      providerName: params.input.providerName,
      baseUrl: params.input.baseUrl ?? null,
      encryptedApiKey,
      apiKeyHint,
      chatModel: params.input.chatModel,
      embeddingModel: params.input.embeddingModel ?? null,
      timeoutMs: params.input.timeoutMs,
      maxOutputTokens: params.input.maxOutputTokens,
      temperature: params.input.temperature,
      globalEnabled: params.input.globalEnabled,
      rerankerMode,
      rerankerEndpointUrl,
      cragMaxIterations,
      cragMaxModelCalls,
      cragEnableLlmJudge,
      enableLlmQueryTransform,
      updatedBy: params.actorUserId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiProviderSettings.id,
      set: {
        providerType: params.input.providerType,
        providerName: params.input.providerName,
        baseUrl: params.input.baseUrl ?? null,
        encryptedApiKey,
        apiKeyHint,
        chatModel: params.input.chatModel,
        embeddingModel: params.input.embeddingModel ?? null,
        timeoutMs: params.input.timeoutMs,
        maxOutputTokens: params.input.maxOutputTokens,
        temperature: params.input.temperature,
        globalEnabled: params.input.globalEnabled,
        rerankerMode,
        rerankerEndpointUrl,
        cragMaxIterations,
        cragMaxModelCalls,
        cragEnableLlmJudge,
        enableLlmQueryTransform,
        updatedBy: params.actorUserId,
        updatedAt: new Date(),
      },
    });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'ai.provider_settings.updated',
    targetType: 'ai_provider_settings',
    targetId: 'default',
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      providerType: params.input.providerType,
      chatModel: params.input.chatModel,
      globalEnabled: params.input.globalEnabled,
      apiKeyUpdated: Boolean(params.input.apiKey || params.input.clearApiKey),
    },
  });

  return getSafeAiProviderSettings();
}

export async function recordAiConnectionTestResult(params: {
  ok: boolean;
  messageFa: string;
}) {
  const existing = await db.query.aiProviderSettings.findFirst({
    where: eq(aiProviderSettings.id, 'default'),
  });
  if (!existing) return;
  await db
    .update(aiProviderSettings)
    .set({
      lastTestedAt: new Date(),
      lastTestOk: params.ok,
      lastTestMessage: params.messageFa,
    })
    .where(eq(aiProviderSettings.id, 'default'));
}

export async function getDepartmentAiSettingsWithCollections(departmentId: string) {
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, departmentId),
  });
  if (!dept) return null;

  const settings = await db.query.aiDepartmentSettings.findFirst({
    where: eq(aiDepartmentSettings.departmentId, departmentId),
  });

  const assignedRows = await db
    .select({ collectionId: departmentKnowledgeCollections.collectionId })
    .from(departmentKnowledgeCollections)
    .where(eq(departmentKnowledgeCollections.departmentId, departmentId));

  return {
    departmentId: dept.id,
    departmentNameFa: dept.nameFa,
    aiEnabled: settings?.aiEnabled ?? dept.aiEnabled,
    welcomeMessageFa: settings?.welcomeMessageFa ?? dept.welcomeMessageFa,
    fallbackMessageFa: settings?.fallbackMessageFa ?? DEFAULT_FALLBACK_MESSAGE_FA,
    autoOfferEscalation: settings?.autoOfferEscalation ?? true,
    minConfidenceScore: settings?.minConfidenceScore ?? 25,
    maxTurnsPerSession: settings?.maxTurnsPerSession ?? 20,
    allowAiDuringHumanHandoff: settings?.allowAiDuringHumanHandoff ?? false,
    collectionIds: assignedRows.map((r) => r.collectionId),
  };
}

export async function listAllDepartmentAiConfigsAdmin() {
  const [deptRows, settingsRows, collectionLinks] = await Promise.all([
    db.select().from(departments).orderBy(departments.displayOrder),
    db.select().from(aiDepartmentSettings),
    db.select().from(departmentKnowledgeCollections),
  ]);

  const settingsMap = new Map(settingsRows.map((s) => [s.departmentId, s]));

  return deptRows.map((d) => {
    const s = settingsMap.get(d.id);
    const cols = collectionLinks
      .filter((c) => c.departmentId === d.id)
      .map((c) => c.collectionId);
    return {
      departmentId: d.id,
      departmentNameFa: d.nameFa,
      slug: d.slug,
      isActive: d.isActive,
      aiEnabled: s?.aiEnabled ?? d.aiEnabled,
      welcomeMessageFa: s?.welcomeMessageFa ?? d.welcomeMessageFa,
      fallbackMessageFa: s?.fallbackMessageFa ?? DEFAULT_FALLBACK_MESSAGE_FA,
      autoOfferEscalation: s?.autoOfferEscalation ?? true,
      minConfidenceScore: s?.minConfidenceScore ?? 25,
      maxTurnsPerSession: s?.maxTurnsPerSession ?? 20,
      allowAiDuringHumanHandoff: s?.allowAiDuringHumanHandoff ?? false,
      collectionIds: cols,
    };
  });
}

export async function upsertDepartmentAiSettings(params: {
  departmentId: string;
  input: {
    aiEnabled: boolean;
    welcomeMessageFa: string;
    fallbackMessageFa: string;
    autoOfferEscalation: boolean;
    minConfidenceScore: number;
    maxTurnsPerSession: number;
    allowAiDuringHumanHandoff: boolean;
    collectionIds?: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, params.departmentId),
  });
  if (!dept) return null;

  await db.transaction(async (tx) => {
    await tx
      .update(departments)
      .set({
        aiEnabled: params.input.aiEnabled,
        welcomeMessageFa: params.input.welcomeMessageFa,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, params.departmentId));

    await tx
      .insert(aiDepartmentSettings)
      .values({
        departmentId: params.departmentId,
        aiEnabled: params.input.aiEnabled,
        welcomeMessageFa: params.input.welcomeMessageFa,
        fallbackMessageFa: params.input.fallbackMessageFa,
        autoOfferEscalation: params.input.autoOfferEscalation,
        minConfidenceScore: params.input.minConfidenceScore,
        maxTurnsPerSession: params.input.maxTurnsPerSession,
        allowAiDuringHumanHandoff: params.input.allowAiDuringHumanHandoff,
        updatedBy: params.actorUserId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: aiDepartmentSettings.departmentId,
        set: {
          aiEnabled: params.input.aiEnabled,
          welcomeMessageFa: params.input.welcomeMessageFa,
          fallbackMessageFa: params.input.fallbackMessageFa,
          autoOfferEscalation: params.input.autoOfferEscalation,
          minConfidenceScore: params.input.minConfidenceScore,
          maxTurnsPerSession: params.input.maxTurnsPerSession,
          allowAiDuringHumanHandoff: params.input.allowAiDuringHumanHandoff,
          updatedBy: params.actorUserId,
          updatedAt: new Date(),
        },
      });

    if (params.input.collectionIds !== undefined) {
      await tx
        .delete(departmentKnowledgeCollections)
        .where(eq(departmentKnowledgeCollections.departmentId, params.departmentId));

      const uniqueColIds = Array.from(new Set(params.input.collectionIds));
      if (uniqueColIds.length > 0) {
        const validCols = await tx.select({ id: knowledgeCollections.id }).from(knowledgeCollections);
        const validSet = new Set(validCols.map((c) => c.id));
        for (const colId of uniqueColIds) {
          if (!validSet.has(colId)) continue;
          await tx.insert(departmentKnowledgeCollections).values({
            departmentId: params.departmentId,
            collectionId: colId,
            assignedBy: params.actorUserId,
          });
        }
      }
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'ai.department_settings.updated',
    targetType: 'department',
    targetId: params.departmentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      aiEnabled: params.input.aiEnabled,
      minConfidenceScore: params.input.minConfidenceScore,
    },
  });

  return getDepartmentAiSettingsWithCollections(params.departmentId);
}
