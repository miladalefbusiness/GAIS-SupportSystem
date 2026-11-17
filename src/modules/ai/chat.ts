import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { checkRateLimit } from '@/src/core/security/rate-limit.ts';
import { db } from '@/src/db/index.ts';
import {
  aiConversations,
  aiDepartmentSettings,
  aiMessages,
  aiUsageLogs,
  departments,
  knowledgeRetrievalRecords,
} from '@/src/db/schema.ts';
import { detectPromptInjectionAttempt } from '../knowledge/text.ts';
import {
  buildGroundedGenerationSystemPrompt,
  type GroundedCitation,
} from '../rag/generation/generator.ts';
import { runEnterpriseRagPipeline } from '../rag/orchestrator.ts';
import {
  type AiProviderAdapter,
  createAiProviderAdapter,
} from './provider.ts';
import {
  DEFAULT_FALLBACK_MESSAGE_FA,
  getInternalAiProviderRuntimeConfig,
} from './settings.ts';

export function buildStrictGroundedSystemPrompt(): string {
  return buildGroundedGenerationSystemPrompt();
}

export interface ChatTurnResult {
  conversationId: string;
  mode: string;
  escalatedToHuman: boolean;
  aiAutoReplyEnabled: boolean;
  customerMessage: {
    id: string;
    senderRole: string;
    content: string;
    createdAt: string;
  };
  assistantMessage: {
    id: string;
    senderRole: string;
    content: string;
    abstained: boolean;
    escalationOffered: boolean;
    retrievalConfidence: number | null;
    responseOutcome?: string | null;
    citations?: GroundedCitation[];
    createdAt: string;
  } | null;
  providerUnavailable?: boolean;
}

export async function handleCustomerAiMessage(params: {
  departmentId: string;
  conversationId?: string;
  customerProfileId?: string | null;
  message: string;
  ipAddress: string | null;
  adapterOverride?: AiProviderAdapter;
}): Promise<ChatTurnResult> {
  // 1. IP-based rate limit for public AI endpoint
  const rl = checkRateLimit(
    `ai-chat:${params.ipAddress || 'unknown'}`,
    30,
    60_000
  );
  if (!rl.allowed) {
    throw new Error(`RATE_LIMITED:${rl.retryAfterSeconds}`);
  }

  // 2. Verify department is active and public
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, params.departmentId),
  });
  if (!dept || !dept.isActive || !dept.isPublic) {
    throw new Error('DEPARTMENT_NOT_AVAILABLE');
  }

  const deptSettingsRow = await db.query.aiDepartmentSettings.findFirst({
    where: eq(aiDepartmentSettings.departmentId, dept.id),
  });
  const deptAiEnabled = deptSettingsRow?.aiEnabled ?? dept.aiEnabled;
  const fallbackMessageFa =
    deptSettingsRow?.fallbackMessageFa || DEFAULT_FALLBACK_MESSAGE_FA;
  const autoOfferEscalation = deptSettingsRow?.autoOfferEscalation ?? true;
  const minConfidenceScore = deptSettingsRow?.minConfidenceScore ?? 25;
  const maxTurnsPerSession = deptSettingsRow?.maxTurnsPerSession ?? 20;
  const allowAiDuringHandoff =
    deptSettingsRow?.allowAiDuringHumanHandoff ?? false;

  // 3. Load or create conversation bound strictly to departmentId
  let conversation = params.conversationId
    ? await db.query.aiConversations.findFirst({
        where: eq(aiConversations.id, params.conversationId),
      })
    : null;

  if (conversation && conversation.departmentId !== dept.id) {
    throw new Error('CONVERSATION_DEPARTMENT_MISMATCH');
  }

  if (!conversation) {
    const newId = `conv_${randomUUID()}`;
    const [inserted] = await db
      .insert(aiConversations)
      .values({
        id: newId,
        departmentId: dept.id,
        customerProfileId: params.customerProfileId ?? null,
        mode: 'ai_assisted',
        escalatedToHuman: false,
        aiAutoReplyEnabled: true,
        turnCount: 0,
      })
      .returning();
    conversation = inserted;
  } else if (!conversation.customerProfileId && params.customerProfileId) {
    await db
      .update(aiConversations)
      .set({ customerProfileId: params.customerProfileId, updatedAt: new Date() })
      .where(eq(aiConversations.id, conversation.id));
    conversation = { ...conversation, customerProfileId: params.customerProfileId };
  }

  // Load prior messages for conversation-aware query contextualization
  const priorMessages = await db
    .select({
      senderRole: aiMessages.senderRole,
      content: aiMessages.content,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversation.id))
    .orderBy(asc(aiMessages.createdAt));

  // 4. ALWAYS persist customer message FIRST so it is never lost on AI errors
  const customerMsgId = `msg_${randomUUID()}`;
  const cleanUserMessage = params.message.trim();
  const [savedCustomerMsg] = await db
    .insert(aiMessages)
    .values({
      id: customerMsgId,
      conversationId: conversation.id,
      senderRole: 'customer',
      content: cleanUserMessage,
      abstained: false,
      escalationOffered: false,
    })
    .returning();

  await db
    .update(aiConversations)
    .set({
      turnCount: conversation.turnCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(aiConversations.id, conversation.id));

  // 5. Respect human handoff mode: never let AI overwrite active human operator conversations
  if (
    conversation.escalatedToHuman ||
    (!conversation.aiAutoReplyEnabled && !allowAiDuringHandoff)
  ) {
    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: null,
    };
  }

  const runtimeConfig = await getInternalAiProviderRuntimeConfig();

  // 6. Check if AI is globally or department-level disabled
  if (!runtimeConfig.globalEnabled || !deptAiEnabled) {
    const disabledText =
      'دستیار هوشمند در این دپارتمان فعال نیست. پیام شما ثبت شد؛ برای ادامه می‌توانید با اپراتور انسانی ارتباط برقرار کنید.';
    const [savedMsg] = await db
      .insert(aiMessages)
      .values({
        id: `msg_${randomUUID()}`,
        conversationId: conversation.id,
        senderRole: 'ai_assistant',
        content: disabledText,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'abstain_insufficient',
        citationsJson: [],
      })
      .returning();

    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: {
        id: savedMsg.id,
        senderRole: savedMsg.senderRole,
        content: savedMsg.content,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'abstain_insufficient',
        citations: [],
        createdAt: savedMsg.createdAt.toISOString(),
      },
    };
  }

  // 7. Enforce session turn limit
  if (conversation.turnCount >= maxTurnsPerSession) {
    const limitMsg =
      'تعداد پیام‌های خودکار این گفت‌وگو به سقف مجاز رسیده است. برای بررسی دقیق‌تر می‌توانید گفت‌وگو را به اپراتور دپارتمان ارجاع دهید.';
    const [savedMsg] = await db
      .insert(aiMessages)
      .values({
        id: `msg_${randomUUID()}`,
        conversationId: conversation.id,
        senderRole: 'ai_assistant',
        content: limitMsg,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'abstain_insufficient',
        citationsJson: [],
      })
      .returning();

    await db.insert(aiUsageLogs).values({
      id: `aul_${randomUUID()}`,
      departmentId: dept.id,
      conversationId: conversation.id,
      providerType: runtimeConfig.providerType,
      modelName: runtimeConfig.chatModel,
      status: 'rate_limited',
      latencyMs: 0,
      errorCode: 'MAX_TURNS_REACHED',
    });

    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: {
        id: savedMsg.id,
        senderRole: savedMsg.senderRole,
        content: savedMsg.content,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'abstain_insufficient',
        citations: [],
        createdAt: savedMsg.createdAt.toISOString(),
      },
    };
  }

  // 8. Prompt-injection guard BEFORE retrieval or LLM invocation
  if (detectPromptInjectionAttempt(cleanUserMessage)) {
    const refusalText =
      'امکان تغییر دستورالعمل‌های امنیتی سامانه یا دسترسی به اطلاعات داخلی و سایر دپارتمان‌ها وجود ندارد. در صورت نیاز به راهنمایی رسمی، سؤال خود را مطرح کنید یا با اپراتور ارتباط بگیرید.';
    const [savedMsg] = await db
      .insert(aiMessages)
      .values({
        id: `msg_${randomUUID()}`,
        conversationId: conversation.id,
        senderRole: 'ai_assistant',
        content: refusalText,
        abstained: true,
        escalationOffered: autoOfferEscalation,
        retrievalConfidence: 0,
        responseOutcome: 'prompt_injection_blocked',
        citationsJson: [],
      })
      .returning();

    await db.insert(knowledgeRetrievalRecords).values({
      id: `krr_${randomUUID()}`,
      conversationId: conversation.id,
      messageId: savedMsg.id,
      departmentId: dept.id,
      queryText: cleanUserMessage.slice(0, 500),
      sourcesJson: [],
      traceJson: { blockedBy: 'prompt_injection_guard' },
      topScore: 0,
      abstained: true,
    });

    await db.insert(aiUsageLogs).values({
      id: `aul_${randomUUID()}`,
      departmentId: dept.id,
      conversationId: conversation.id,
      providerType: runtimeConfig.providerType,
      modelName: runtimeConfig.chatModel,
      status: 'abstained',
      latencyMs: 0,
      errorCode: 'PROMPT_INJECTION_BLOCKED',
    });

    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: {
        id: savedMsg.id,
        senderRole: savedMsg.senderRole,
        content: savedMsg.content,
        abstained: true,
        escalationOffered: autoOfferEscalation,
        retrievalConfidence: 0,
        responseOutcome: 'prompt_injection_blocked',
        citations: [],
        createdAt: savedMsg.createdAt.toISOString(),
      },
    };
  }

  const adapter =
    params.adapterOverride ?? createAiProviderAdapter(runtimeConfig);

  // 9. Run Advanced Enterprise RAG Pipeline (Stages 3 + 4 + 5)
  const startedAt = Date.now();
  try {
    const rag = await runEnterpriseRagPipeline({
      departmentId: dept.id,
      departmentNameFa: dept.nameFa,
      query: cleanUserMessage,
      conversationHistory: priorMessages.slice(-8),
      runtimeConfig,
      minConfidenceScore,
      autoOfferEscalation,
      fallbackMessageFa,
      adapter,
    });

    const [savedMsg] = await db
      .insert(aiMessages)
      .values({
        id: `msg_${randomUUID()}`,
        conversationId: conversation.id,
        senderRole: 'ai_assistant',
        content: rag.answerFa,
        abstained: rag.abstained,
        escalationOffered: rag.escalationRecommended,
        retrievalConfidence: rag.topScore,
        responseOutcome: rag.outcome,
        citationsJson: rag.citations,
      })
      .returning();

    await db.insert(knowledgeRetrievalRecords).values({
      id: `krr_${randomUUID()}`,
      conversationId: conversation.id,
      messageId: savedMsg.id,
      departmentId: dept.id,
      queryText: cleanUserMessage.slice(0, 500),
      sourcesJson: rag.crag.evidence.map((m) => ({
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        title: m.title,
        score: m.score,
        snippet: m.matchedSnippet.slice(0, 220),
        documentVersion: m.documentVersion,
        pageNumber: m.pageNumber,
        sectionTitle: m.sectionTitle,
        sheetName: m.sheetName,
        sourceRef: m.sourceRef,
      })),
      traceJson: rag.traceSummary as unknown as Record<string, unknown>,
      topScore: rag.topScore,
      abstained: rag.abstained,
    });

    const usageErrorCode =
      rag.outcome === 'abstain_conflicting'
        ? 'CONFLICTING_KB_SOURCES'
        : rag.outcome === 'abstain_insufficient'
        ? rag.verification && !rag.verification.verified
          ? 'VERIFICATION_FAILED_ABSTAINED'
          : 'INSUFFICIENT_KB_MATCH'
        : null;

    await db.insert(aiUsageLogs).values({
      id: `aul_${randomUUID()}`,
      departmentId: dept.id,
      conversationId: conversation.id,
      providerType: runtimeConfig.providerType,
      modelName: rag.generation?.modelName || runtimeConfig.chatModel,
      status: rag.abstained ? 'abstained' : 'success',
      latencyMs: rag.totalLatencyMs,
      promptTokens: rag.generation?.promptTokens ?? null,
      completionTokens: rag.generation?.completionTokens ?? null,
      errorCode: usageErrorCode,
    });

    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: {
        id: savedMsg.id,
        senderRole: savedMsg.senderRole,
        content: savedMsg.content,
        abstained: rag.abstained,
        escalationOffered: rag.escalationRecommended,
        retrievalConfidence: rag.topScore,
        responseOutcome: rag.outcome,
        citations: rag.citations,
        createdAt: savedMsg.createdAt.toISOString(),
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errCode = err instanceof Error ? err.message : 'PROVIDER_ERROR';

    // Log safely without PII or API keys
    logger.warn('ai.chat.provider_unavailable', {
      departmentId: dept.id,
      conversationId: conversation.id,
      providerType: runtimeConfig.providerType,
      errorCode: errCode,
    });

    await db.insert(aiUsageLogs).values({
      id: `aul_${randomUUID()}`,
      departmentId: dept.id,
      conversationId: conversation.id,
      providerType: runtimeConfig.providerType,
      modelName: runtimeConfig.chatModel,
      status: 'provider_error',
      latencyMs,
      errorCode: errCode.slice(0, 80),
    });

    const unavailableFallback =
      'در حال حاضر ارتباط با سرویس پاسخگویی هوشمند برقرار نشد، اما پیام شما با موفقیت ذخیره شده است. می‌توانید از طریق دکمه «ارتباط با اپراتور» درخواست خود را مستقیماً به کارشناس دپارتمان ارسال کنید.';

    const [savedMsg] = await db
      .insert(aiMessages)
      .values({
        id: `msg_${randomUUID()}`,
        conversationId: conversation.id,
        senderRole: 'ai_assistant',
        content: unavailableFallback,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'provider_unavailable',
        citationsJson: [],
      })
      .returning();

    return {
      conversationId: conversation.id,
      mode: conversation.mode,
      escalatedToHuman: conversation.escalatedToHuman,
      aiAutoReplyEnabled: conversation.aiAutoReplyEnabled,
      customerMessage: {
        id: savedCustomerMsg.id,
        senderRole: savedCustomerMsg.senderRole,
        content: savedCustomerMsg.content,
        createdAt: savedCustomerMsg.createdAt.toISOString(),
      },
      assistantMessage: {
        id: savedMsg.id,
        senderRole: savedMsg.senderRole,
        content: savedMsg.content,
        abstained: true,
        escalationOffered: true,
        retrievalConfidence: 0,
        responseOutcome: 'provider_unavailable',
        citations: [],
        createdAt: savedMsg.createdAt.toISOString(),
      },
      providerUnavailable: true,
    };
  }
}

export async function handoffConversationToHuman(params: {
  conversationId: string;
  departmentId?: string;
  reason?: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const conv = await db.query.aiConversations.findFirst({
    where: eq(aiConversations.id, params.conversationId),
  });
  if (!conv) return null;
  if (params.departmentId && conv.departmentId !== params.departmentId) {
    throw new Error('CONVERSATION_DEPARTMENT_MISMATCH');
  }

  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, conv.departmentId),
  });

  if (!conv.escalatedToHuman) {
    await db
      .update(aiConversations)
      .set({
        mode: 'waiting_for_operator',
        escalatedToHuman: true,
        aiAutoReplyEnabled: false,
        handoffRequestedAt: new Date(),
        handoffReason: params.reason || 'درخواست مستقیم کاربر',
        updatedAt: new Date(),
      })
      .where(eq(aiConversations.id, conv.id));

    const sysMessage = dept?.humanOperatorsAvailable
      ? 'درخواست ارتباط با اپراتور ثبت شد. پاسخگویی خودکار هوش مصنوعی متوقف گردید و تمامی پیام‌های قبلی شما برای کارشناس دپارتمان حفظ شده است.'
      : 'درخواست ارتباط با اپراتور ثبت شد. در حال حاضر اپراتور آنلاین در این دپارتمان حضور ندارد، اما گفت‌وگوی شما با حفظ کامل تاریخچه در صف انتظار قرار گرفت.';

    await db.insert(aiMessages).values({
      id: `msg_${randomUUID()}`,
      conversationId: conv.id,
      senderRole: 'system',
      content: sysMessage,
      abstained: false,
      escalationOffered: false,
    });

    await db.insert(aiUsageLogs).values({
      id: `aul_${randomUUID()}`,
      departmentId: conv.departmentId,
      conversationId: conv.id,
      providerType: 'system',
      modelName: 'handoff',
      status: 'escalated',
      latencyMs: 0,
    });

    await recordAuditLog({
      actorType: 'anonymous',
      action: 'ai.conversation.handoff_requested',
      targetType: 'ai_conversation',
      targetId: conv.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: { departmentId: conv.departmentId },
    });
  }

  const messages = await db
    .select({
      id: aiMessages.id,
      senderRole: aiMessages.senderRole,
      content: aiMessages.content,
      abstained: aiMessages.abstained,
      escalationOffered: aiMessages.escalationOffered,
      responseOutcome: aiMessages.responseOutcome,
      citationsJson: aiMessages.citationsJson,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conv.id))
    .orderBy(asc(aiMessages.createdAt));

  return {
    conversationId: conv.id,
    departmentId: conv.departmentId,
    mode: 'waiting_for_operator',
    escalatedToHuman: true,
    aiAutoReplyEnabled: false,
    messages: messages.map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      content: m.content,
      abstained: m.abstained,
      escalationOffered: m.escalationOffered,
      responseOutcome: m.responseOutcome,
      citations: m.citationsJson,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function getPublicConversationHistory(conversationId: string) {
  const conv = await db.query.aiConversations.findFirst({
    where: eq(aiConversations.id, conversationId),
  });
  if (!conv) return null;

  const messages = await db
    .select({
      id: aiMessages.id,
      senderRole: aiMessages.senderRole,
      content: aiMessages.content,
      abstained: aiMessages.abstained,
      escalationOffered: aiMessages.escalationOffered,
      responseOutcome: aiMessages.responseOutcome,
      citationsJson: aiMessages.citationsJson,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conv.id))
    .orderBy(asc(aiMessages.createdAt));

  return {
    conversationId: conv.id,
    departmentId: conv.departmentId,
    mode: conv.mode,
    escalatedToHuman: conv.escalatedToHuman,
    aiAutoReplyEnabled: conv.aiAutoReplyEnabled,
    messages: messages.map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      content: m.content,
      abstained: m.abstained,
      escalationOffered: m.escalationOffered,
      responseOutcome: m.responseOutcome,
      citations: m.citationsJson,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function listAiReportsAdmin() {
  const [logs, retrievals, deptRows] = await Promise.all([
    db.select().from(aiUsageLogs).orderBy(desc(aiUsageLogs.createdAt)).limit(60),
    db
      .select()
      .from(knowledgeRetrievalRecords)
      .orderBy(desc(knowledgeRetrievalRecords.createdAt))
      .limit(40),
    db.select({ id: departments.id, nameFa: departments.nameFa }).from(departments),
  ]);

  const deptMap = new Map(deptRows.map((d) => [d.id, d.nameFa]));

  return {
    usageLogs: logs.map((l) => ({
      ...l,
      departmentNameFa: l.departmentId ? deptMap.get(l.departmentId) || l.departmentId : '—',
      createdAt: l.createdAt.toISOString(),
    })),
    retrievalRecords: retrievals.map((r) => ({
      ...r,
      departmentNameFa: deptMap.get(r.departmentId) || r.departmentId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
