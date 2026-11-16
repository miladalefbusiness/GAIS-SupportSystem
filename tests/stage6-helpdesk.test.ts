import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetRateLimitBuckets } from '../src/core/security/rate-limit.ts';
import { db, pool } from '../src/db/index.ts';
import {
  aiConversations,
  aiDepartmentSettings,
  aiMessages,
  aiProviderSettings,
  aiUsageLogs,
  auditLogs,
  customerProfiles,
  departments,
  knowledgeRetrievalRecords,
  ticketMessages,
  tickets,
  users,
} from '../src/db/schema.ts';
import {
  getPublicConversationHistory,
  handleCustomerAiMessage,
} from '../src/modules/ai/chat.ts';
import type { AiProviderAdapter } from '../src/modules/ai/provider.ts';
import { upsertAiProviderSettings } from '../src/modules/ai/settings.ts';
import {
  deleteKnowledgeDocument,
  uploadAndIndexDocument,
} from '../src/modules/knowledge/service.ts';
import {
  convertAiConversationToTicket,
  getCustomerTicketDetail,
} from '../src/modules/tickets/service.ts';

const hasSqlEnv = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

describe.skipIf(!hasSqlEnv)('Stage 6 Helpdesk Multi-Turn, Citations & Ticket Handoff Integration', () => {
  const actorUserId = 's6test_actor';
  const deptId = 's6test_dept';
  const customerId = 's6test_customer';
  const createdDocIds: string[] = [];
  const createdConvIds: string[] = [];
  const createdTicketIds: string[] = [];
  let originalProviderRow: typeof aiProviderSettings.$inferSelect | undefined;

  const mockGroundedAdapter: AiProviderAdapter = {
    async generateGroundedReply(req) {
      const excerpts = Array.from(
        req.userContent.matchAll(
          /<untrusted_kb_excerpt[^>]*ref="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/untrusted_kb_excerpt>/g
        )
      );
      if (excerpts.length === 0) {
        return {
          text: JSON.stringify({
            status: 'abstain_insufficient',
            answerFa: '',
            citedRefs: [],
          }),
          modelName: 's6-mock-llm',
          promptTokens: 60,
          completionTokens: 20,
        };
      }
      const firstRef = excerpts[0][1];
      const snippet = excerpts[0][2].trim().slice(0, 260);
      return {
        text: JSON.stringify({
          status: 'answered',
          answerFa: `${snippet} [${firstRef}]`,
          citedRefs: [firstRef],
          assumptionsFa: [],
        }),
        modelName: 's6-mock-llm',
        promptTokens: 140,
        completionTokens: 55,
      };
    },
    async generateEmbedding() {
      return null;
    },
    async testConnection() {
      return {
        ok: true,
        latencyMs: 5,
        modelChecked: 's6-mock-llm',
        messageFa: 'OK',
      };
    },
  };

  beforeAll(async () => {
    resetRateLimitBuckets();

    await db
      .insert(users)
      .values({
        id: actorUserId,
        username: 's6test_user',
        email: 's6test@test.local',
        name: 'کاربر تست مرحله ۶',
        status: 'active',
        mustChangePassword: false,
      })
      .onConflictDoNothing();

    await db
      .insert(customerProfiles)
      .values({
        id: customerId,
        nationalIdHmac: 's6test_nid_hmac_unique',
        encryptedNationalId: 's6test_enc_nid',
        nationalIdLast4: '6789',
        fullName: 'مشتری تست مرحله ۶',
      })
      .onConflictDoNothing();

    originalProviderRow = await db.query.aiProviderSettings.findFirst({
      where: eq(aiProviderSettings.id, 'default'),
    });

    await upsertAiProviderSettings({
      input: {
        providerType: 'openai_compatible',
        providerName: 'Stage 6 Test AI',
        baseUrl: 'https://ai.example.local/v1',
        apiKey: 'sk-test-stage6-key-1234',
        chatModel: 'test-stage6-model',
        embeddingModel: null,
        timeoutMs: 10000,
        maxOutputTokens: 512,
        temperature: '0.1',
        globalEnabled: true,
        rerankerMode: 'cross_feature',
        cragMaxIterations: 2,
        cragMaxModelCalls: 1,
        cragEnableLlmJudge: false,
        enableLlmQueryTransform: false,
      },
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage6',
    });

    await db
      .insert(departments)
      .values({
        id: deptId,
        slug: 's6test-billing',
        nameFa: 'مالی و استرداد تستی',
        descriptionFa: 'دپارتمان تست مرحله ۶',
        iconKey: 'building',
        displayOrder: 960,
        isActive: true,
        isPublic: true,
        aiEnabled: true,
        humanOperatorsAvailable: false,
      })
      .onConflictDoNothing();

    await db
      .insert(aiDepartmentSettings)
      .values({
        departmentId: deptId,
        aiEnabled: true,
        welcomeMessageFa: 'خوش آمدید',
        fallbackMessageFa: 'اطلاعات کافی در مخزن دانش وجود ندارد.',
        autoOfferEscalation: true,
        minConfidenceScore: 25,
        maxTurnsPerSession: 20,
        allowAiDuringHumanHandoff: false,
        updatedBy: actorUserId,
      })
      .onConflictDoNothing();

    const doc = await uploadAndIndexDocument({
      filename: 'stage6-refund-guide.md',
      buffer: Buffer.from(
        [
          '# راهنمای استرداد وجه و کارمزدها',
          '',
          '## ماده ۱: زمان و نحوه واریز',
          'مهلت بازپرداخت وجه پس از ثبت درخواست استرداد حداکثر ۷ روز کاری است و مبلغ فقط به شماره شبا ثبت‌شده واریز می‌شود.',
          '',
          '## ماده ۲: کارمزد انصراف',
          'کارمزد لغو پیش از صدور فاکتور معادل ۰ ریال است و هیچ هزینه‌ای کسر نمی‌گردد.',
        ].join('\n'),
        'utf-8'
      ),
      titleFa: 'راهنمای جامع استرداد و کارمزد',
      collectionId: null,
      scope: 'department',
      classification: 'department',
      validityStatus: 'current',
      isEnabled: true,
      departmentIds: [deptId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage6',
    });
    createdDocIds.push(doc.id);
  });

  afterAll(async () => {
    try {
      if (createdTicketIds.length > 0) {
        await db.delete(tickets).where(inArray(tickets.id, createdTicketIds));
      }
      if (createdConvIds.length > 0) {
        await db
          .delete(aiUsageLogs)
          .where(inArray(aiUsageLogs.conversationId, createdConvIds));
        await db
          .delete(aiConversations)
          .where(inArray(aiConversations.id, createdConvIds));
      }
      for (const docId of createdDocIds) {
        await deleteKnowledgeDocument({
          documentId: docId,
          actorUserId,
          ipAddress: null,
          userAgent: null,
        });
      }
      await db.delete(customerProfiles).where(eq(customerProfiles.id, customerId));
      await db.delete(departments).where(eq(departments.id, deptId));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, actorUserId));

      if (originalProviderRow) {
        await db
          .insert(aiProviderSettings)
          .values(originalProviderRow)
          .onConflictDoUpdate({
            target: aiProviderSettings.id,
            set: {
              providerType: originalProviderRow.providerType,
              providerName: originalProviderRow.providerName,
              baseUrl: originalProviderRow.baseUrl,
              encryptedApiKey: originalProviderRow.encryptedApiKey,
              apiKeyHint: originalProviderRow.apiKeyHint,
              chatModel: originalProviderRow.chatModel,
              embeddingModel: originalProviderRow.embeddingModel,
              timeoutMs: originalProviderRow.timeoutMs,
              maxOutputTokens: originalProviderRow.maxOutputTokens,
              temperature: originalProviderRow.temperature,
              globalEnabled: originalProviderRow.globalEnabled,
              rerankerMode: originalProviderRow.rerankerMode,
              rerankerEndpointUrl: originalProviderRow.rerankerEndpointUrl,
              cragMaxIterations: originalProviderRow.cragMaxIterations,
              cragMaxModelCalls: originalProviderRow.cragMaxModelCalls,
              cragEnableLlmJudge: originalProviderRow.cragEnableLlmJudge,
              enableLlmQueryTransform: originalProviderRow.enableLlmQueryTransform,
              updatedBy: originalProviderRow.updatedBy,
              updatedAt: originalProviderRow.updatedAt,
            },
          });
      } else {
        await db.delete(aiProviderSettings).where(eq(aiProviderSettings.id, 'default'));
      }
      await db.delete(users).where(eq(users.id, actorUserId));
    } finally {
      await pool.end();
    }
  });

  it('persists verified citations, CRAG trace, and supports conversation-aware multi-turn follow-up', async () => {
    // Turn 1: Initial question
    const turn1 = await handleCustomerAiMessage({
      departmentId: deptId,
      message: 'مهلت استرداد وجه چقدر است؟',
      ipAddress: '10.6.0.1',
      adapterOverride: mockGroundedAdapter,
    });
    createdConvIds.push(turn1.conversationId);

    expect(turn1.assistantMessage?.abstained).toBe(false);
    expect(turn1.assistantMessage?.responseOutcome).toBe('verified_answer');
    expect(turn1.assistantMessage?.citations?.length).toBeGreaterThanOrEqual(1);
    expect(turn1.assistantMessage?.citations?.[0].title).toBe(
      'راهنمای جامع استرداد و کارمزد'
    );
    expect(turn1.assistantMessage?.citations?.[0].documentVersion).toBe(1);

    // Turn 2: Follow-up referring implicitly to prior turn context
    const turn2 = await handleCustomerAiMessage({
      departmentId: deptId,
      conversationId: turn1.conversationId,
      message: 'و کارمزد آن چقدر است؟',
      ipAddress: '10.6.0.1',
      adapterOverride: mockGroundedAdapter,
    });

    expect(turn2.assistantMessage?.abstained).toBe(false);
    expect(turn2.assistantMessage?.citations?.length).toBeGreaterThanOrEqual(1);

    // Verify citations & trace persisted in DB
    const history = await getPublicConversationHistory(turn1.conversationId);
    expect(history).not.toBeNull();
    const assistantTurns = history!.messages.filter((m) => m.senderRole === 'ai_assistant');
    expect(assistantTurns.length).toBe(2);
    expect(Array.isArray(assistantTurns[0].citations)).toBe(true);
    expect(assistantTurns[0].citations!.length).toBeGreaterThanOrEqual(1);

    const traces = await db
      .select()
      .from(knowledgeRetrievalRecords)
      .where(eq(knowledgeRetrievalRecords.conversationId, turn1.conversationId));
    expect(traces.length).toBe(2);
    const traceJson = traces[1].traceJson as Record<string, unknown>;
    expect(traceJson.strategy).toBeDefined();
    expect(traceJson.cragDecision).toBeDefined();

    const storedMsgs = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, turn1.conversationId));
    expect(storedMsgs.some((m) => (m.citationsJson?.length ?? 0) > 0)).toBe(true);
  });

  it('transfers conversation history and adds operator-only RAG/CRAG internal_note on ticket escalation', async () => {
    const convRes = await handleCustomerAiMessage({
      departmentId: deptId,
      message: 'مهلت استرداد وجه و شماره شبا چگونه است؟',
      ipAddress: '10.6.0.2',
      adapterOverride: mockGroundedAdapter,
    });
    createdConvIds.push(convRes.conversationId);

    const conversion = await convertAiConversationToTicket({
      customerId,
      customerName: 'مشتری تست مرحله ۶',
      aiConversationId: convRes.conversationId,
      reason: 'نیاز به بررسی موردی توسط کارشناس',
      ipAddress: '10.6.0.2',
      userAgent: 'vitest-stage6',
    });
    createdTicketIds.push(conversion.ticket.id);

    // Customer-visible ticket detail must preserve customer & AI messages WITHOUT internal_note
    const customerDetail = await getCustomerTicketDetail(
      customerId,
      conversion.ticket.id
    );
    expect(customerDetail).not.toBeNull();
    expect(customerDetail!.messages.some((m) => m.senderType === 'customer')).toBe(true);
    expect(customerDetail!.messages.some((m) => m.senderType === 'ai_assistant')).toBe(
      true
    );
    expect(
      customerDetail!.messages.some((m) =>
        m.body.includes('گزارش خودکار موتور بازیابی دانش')
      )
    ).toBe(false);

    // Database must contain the internal_note for operators
    const allTicketMsgs = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, conversion.ticket.id));
    const internalRagNote = allTicketMsgs.find(
      (m) =>
        m.visibility === 'internal_note' &&
        m.body.includes('گزارش خودکار موتور بازیابی دانش')
    );
    expect(internalRagNote).toBeDefined();
    expect(internalRagNote!.body).toContain('راهنمای جامع استرداد و کارمزد');
  });
});
