import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/src/db/index.ts';
import {
  departments,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeQaEntries,
  users,
} from '@/src/db/schema.ts';
import { createAiProviderAdapter, type AiProviderAdapter } from '@/src/modules/ai/provider.ts';
import {
  createQaEntry,
  uploadAndIndexDocument,
} from '@/src/modules/knowledge/service.ts';
import {
  evaluateEvidenceWithCrag,
  runCorrectiveRagController,
} from '@/src/modules/rag/crag/controller.ts';
import type { AdvancedRetrievalResult } from '@/src/modules/rag/retrieval/engine.ts';

function buildFakeRetrievalResult(
  overrides: Partial<AdvancedRetrievalResult>
): AdvancedRetrievalResult {
  return {
    matches: [],
    topScore: 0,
    conflictDetected: false,
    conflictSummaryFa: null,
    trace: {
      strategy: 'hybrid',
      strategyReasonFa: 'hybrid',
      queryTransform: {
        originalQuery: 'سوال تستی',
        normalizedQuery: 'سوال تستی',
        contextualizedQuery: 'سوال تستی',
        identifiers: [],
        subQueries: ['سوال تستی'],
        generatedQueries: [
          { query: 'سوال تستی', type: 'normalized', reason: 'primary' },
        ],
        usedLlmTransform: false,
      },
      authorizedDocCount: 1,
      authorizedQaCount: 1,
      lexicalDocHitCount: 1,
      lexicalQaHitCount: 0,
      semanticDocHitCount: 0,
      semanticQaHitCount: 0,
      fusedCandidateCount: 1,
      rerankMethod: 'cross_feature',
      parentExpandedCount: 0,
      latencyMs: 10,
    },
    ...overrides,
  };
}

describe('Stage 4 CRAG Unit Evaluation (6 Criteria)', () => {
  it('evaluates Relevant, Ambiguous, and Insufficient across all 6 CRAG dimensions', () => {
    const rich = buildFakeRetrievalResult({
      topScore: 88,
      matches: [
        {
          sourceType: 'document_chunk',
          sourceId: 'c1',
          parentId: 'd1',
          title: 'آیین‌نامه تمدید گواهی',
          content:
            'مهلت تمدید گواهی سازمانی حداکثر ۳۰ روز کاری است و هزینه صدور ۲۰۰ هزار تومان است. گام اول: ثبت درخواست در سامانه.',
          matchedSnippet: 'مهلت تمدید گواهی سازمانی حداکثر ۳۰ روز کاری است.',
          score: 88,
          rrfScore: 0.032,
          rerankScore: 88,
          lexicalRank: 1,
          semanticRank: 1,
          matchedBy: ['fts', 'vector'],
          scope: 'department',
          classification: 'department',
          documentVersion: 1,
          validityStatus: 'current',
          pageNumber: 2,
          sheetName: null,
          sectionTitle: 'ماده ۴: شرایط تمدید',
          headingPath: 'ماده ۴: شرایط تمدید',
          sourceRef: 'doc:d1#p2',
          expandedFromParent: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    const evalRelevant = evaluateEvidenceWithCrag({
      query: 'مهلت و هزینه تمدید گواهی چقدر است؟',
      retrieval: rich,
      minConfidenceScore: 25,
    });
    expect(evalRelevant.decision).toBe('relevant');
    expect(evalRelevant.criteria.authorization).toBe(100);
    expect(evalRelevant.criteria.currency).toBe(100);
    expect(evalRelevant.criteria.consistency).toBe(100);
    expect(evalRelevant.criteria.relevance).toBeGreaterThanOrEqual(60);

    // Superseded document fails currency check -> insufficient
    const superseded = buildFakeRetrievalResult({
      topScore: 85,
      matches: [{ ...rich.matches[0], validityStatus: 'superseded' }],
    });
    const evalSuperseded = evaluateEvidenceWithCrag({
      query: 'مهلت تمدید گواهی چقدر است؟',
      retrieval: superseded,
      minConfidenceScore: 25,
    });
    expect(evalSuperseded.decision).toBe('insufficient');
    expect(evalSuperseded.criteria.currency).toBe(0);

    // Partial match missing identifier -> ambiguous
    const missingId = buildFakeRetrievalResult({
      topScore: 54,
      matches: [
        {
          ...rich.matches[0],
          score: 54,
          content: 'برای تمدید گواهی فرم اولیه را ارسال کنید تا بررسی شود.',
        },
      ],
      trace: {
        ...buildFakeRetrievalResult({}).trace,
        queryTransform: {
          originalQuery: 'خطای ERR-992 در تمدید گواهی',
          normalizedQuery: 'خطای err-992 در تمدید گواهی',
          contextualizedQuery: 'خطای err-992 در تمدید گواهی',
          identifiers: ['err-992'],
          subQueries: ['خطای ERR-992 در تمدید گواهی'],
          generatedQueries: [
            {
              query: 'خطای err-992 در تمدید گواهی',
              type: 'normalized',
              reason: 'primary',
            },
          ],
          usedLlmTransform: false,
        },
      },
    });
    const evalAmbiguous = evaluateEvidenceWithCrag({
      query: 'خطای ERR-992 در تمدید گواهی',
      retrieval: missingId,
      minConfidenceScore: 25,
    });
    expect(evalAmbiguous.decision).toBe('ambiguous');
  });
});

const hasSqlEnv = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

describe.skipIf(!hasSqlEnv)(
  'Stage 4 CRAG Bounded Corrective Loop & Strict Abstinence (PostgreSQL)',
  () => {
    const ACTOR_ID = 's4test_actor';
    const DEPT_MAIN = 's4test_dept_main';
    const DEPT_SECRET = 's4test_dept_secret';
    const COL_ID = 's4test_col_main';
    const createdDocIds: string[] = [];
    const createdQaIds: string[] = [];

    beforeAll(async () => {
      await db
        .insert(users)
        .values({
          id: ACTOR_ID,
          username: 's4test_user',
          email: 's4test@test.local',
          name: 'تست مرحله ۴',
          status: 'active',
          mustChangePassword: false,
        })
        .onConflictDoNothing();

      await db
        .insert(departments)
        .values([
          {
            id: DEPT_MAIN,
            slug: 's4-main',
            nameFa: 'امور مشترکین تست مرحله ۴',
            descriptionFa: 'تست کنترلگر CRAG',
            iconKey: 'building',
            displayOrder: 970,
            isActive: true,
            isPublic: true,
            aiEnabled: true,
            humanOperatorsAvailable: true,
          },
          {
            id: DEPT_SECRET,
            slug: 's4-secret',
            nameFa: 'بخش محرمانه تست مرحله ۴',
            descriptionFa: 'تست ایزولاسیون',
            iconKey: 'shield',
            displayOrder: 971,
            isActive: true,
            isPublic: true,
            aiEnabled: true,
            humanOperatorsAvailable: true,
          },
        ])
        .onConflictDoNothing();

      await db
        .insert(knowledgeCollections)
        .values({
          id: COL_ID,
          slug: 's4-col-main',
          nameFa: 'مجموعه قوانین مشترکین',
          scope: 'department',
          isActive: true,
        })
        .onConflictDoNothing();

      const doc1 = await uploadAndIndexDocument({
        titleFa: 'بخشنامه استرداد و کارمزد لغو',
        filename: 'refund-policy.md',
        buffer: Buffer.from(
          [
            '# بخشنامه استرداد وجه و لغو سفارش',
            '',
            '## ماده ۳: مبلغ و مهلت بازگشت وجه',
            'در صورت لغو سفارش پیش از ارسال، کارمزد لغو معادل صفر ریال است و بازپرداخت طی ۷۲ ساعت کاری انجام می‌شود.',
            'مدارک مورد نیاز برای ثبت درخواست استرداد شامل شماره پیگیری سفارش و شماره شبا به نام متقاضی است.',
          ].join('\n'),
          'utf-8'
        ),
        collectionId: COL_ID,
        scope: 'department',
        classification: 'department',
        isEnabled: true,
        departmentIds: [DEPT_MAIN],
        actorUserId: ACTOR_ID,
        ipAddress: null,
        userAgent: null,
      });
      createdDocIds.push(doc1.id);

      const docSecret = await uploadAndIndexDocument({
        titleFa: 'رمز محرمانه خزانه',
        filename: 'secret-vault.txt',
        buffer: Buffer.from('کلید خصوصی خزانه مالی سازمان CODE-9999 است.', 'utf-8'),
        collectionId: null,
        scope: 'department',
        classification: 'department',
        isEnabled: true,
        departmentIds: [DEPT_SECRET],
        actorUserId: ACTOR_ID,
        ipAddress: null,
        userAgent: null,
      });
      createdDocIds.push(docSecret.id);
    });

    afterAll(async () => {
      if (createdDocIds.length > 0) {
        await db
          .delete(knowledgeDocuments)
          .where(inArray(knowledgeDocuments.id, createdDocIds));
      }
      if (createdQaIds.length > 0) {
        await db
          .delete(knowledgeQaEntries)
          .where(inArray(knowledgeQaEntries.id, createdQaIds));
      }
      await db.delete(knowledgeCollections).where(eq(knowledgeCollections.id, COL_ID));
      await db
        .delete(departments)
        .where(inArray(departments.id, [DEPT_MAIN, DEPT_SECRET]));
      await db.delete(users).where(eq(users.id, ACTOR_ID));
      await pool.end().catch(() => {});
    });

    it('proceeds directly when Relevant without unnecessary corrective iterations', async () => {
      const res = await runCorrectiveRagController({
        departmentId: DEPT_MAIN,
        query: 'کارمزد لغو سفارش و مدارک مورد نیاز استرداد چیست؟',
        budget: { maxIterations: 2, maxModelCalls: 1, minConfidenceScore: 25 },
      });

      expect(res.finalDecision).toBe('relevant');
      expect(res.actionOutcome).toBe('proceed_to_generation');
      expect(res.iterationsUsed).toBe(0);
      expect(res.evidence.length).toBeGreaterThan(0);
      expect(res.evidence[0].content).toContain('۷۲ ساعت');
    });

    it('runs bounded corrective cycle for colloquial/incomplete query using only internal KB (and respects maxModelCalls)', async () => {
      let llmCallCount = 0;
      const mockAdapter: AiProviderAdapter = {
        ...createAiProviderAdapter({
          providerType: 'gemini',
          providerName: 'mock',
          baseUrl: null,
          apiKey: null,
          chatModel: 'mock',
          embeddingModel: null,
          timeoutMs: 3000,
          maxOutputTokens: 256,
          temperature: 0,
          globalEnabled: true,
        }),
        async generateGroundedReply(req) {
          llmCallCount++;
          if (req.systemInstruction.includes('alternativeQueries')) {
            return {
              text: JSON.stringify({
                decision: 'ambiguous',
                alternativeQueries: [
                  'بخشنامه استرداد وجه و لغو سفارش کارمزد',
                  'شماره شبا استرداد',
                ],
                reasonFa: 'نیاز به جستجوی دقیق‌تر بخشنامه استرداد.',
              }),
              modelName: 'mock',
              promptTokens: 50,
              completionTokens: 30,
            };
          }
          return {
            text: JSON.stringify({ scores: [{ index: 1, score: 92 }] }),
            modelName: 'mock',
            promptTokens: 40,
            completionTokens: 15,
          };
        },
        async generateEmbedding() {
          return null;
        },
      };

      const res = await runCorrectiveRagController({
        departmentId: DEPT_MAIN,
        query: 'اگه پشیمون بشم پولم کی برمی‌گرده و چقدر کم می‌شه؟',
        adapter: mockAdapter,
        budget: {
          maxIterations: 2,
          maxModelCalls: 2,
          timeoutBudgetMs: 8000,
          minConfidenceScore: 25,
          enableLlmJudge: true,
        },
      });

      expect(llmCallCount).toBeLessThanOrEqual(2);
      expect(res.modelCallsUsed).toBeLessThanOrEqual(2);
      expect(res.iterationsUsed).toBeLessThanOrEqual(2);
      expect(res.correctiveSteps.length).toBeGreaterThan(0);
    });

    it('strictly abstains after bounded loop when query has no authorized answer or targets another department', async () => {
      const res = await runCorrectiveRagController({
        departmentId: DEPT_MAIN,
        query: 'رمز محرمانه خزانه CODE-9999 چیست؟',
        budget: {
          maxIterations: 2,
          maxModelCalls: 0,
          minConfidenceScore: 30,
        },
      });

      expect(res.finalDecision).toBe('insufficient');
      expect(res.actionOutcome).toBe('abstain_insufficient');
      expect(res.iterationsUsed).toBeLessThanOrEqual(2);
      expect(res.evidence.some((e) => e.content.includes('CODE-9999'))).toBe(false);
      expect(
        res.correctiveSteps.some((s) => s.actionsTaken.includes('abstain_and_escalate'))
      ).toBe(true);
    });

    it('halts immediately and marks abstain_conflicting when contradictory sources exist', async () => {
      const qaA = await createQaEntry({
        input: {
          question: 'هزینه صدور کارت عضویت ویژه چقدر است؟',
          alternativeQuestions: [],
          officialAnswer: 'هزینه صدور کارت عضویت ویژه ۵۰۰ هزار تومان است.',
          category: 'عمومی',
          keywords: ['کارت عضویت'],
          scope: 'department',
          status: 'published',
          departmentIds: [DEPT_MAIN],
        },
        actorUserId: ACTOR_ID,
        ipAddress: null,
        userAgent: null,
      });
      const qaB = await createQaEntry({
        input: {
          question: 'مبلغ صدور کارت عضویت ویژه',
          alternativeQuestions: [],
          officialAnswer: 'مبلغ صدور کارت عضویت ویژه ۱۲۰ هزار تومان است.',
          category: 'عمومی',
          keywords: ['کارت عضویت'],
          scope: 'department',
          status: 'published',
          departmentIds: [DEPT_MAIN],
        },
        actorUserId: ACTOR_ID,
        ipAddress: null,
        userAgent: null,
      });
      createdQaIds.push(qaA.id, qaB.id);

      const res = await runCorrectiveRagController({
        departmentId: DEPT_MAIN,
        query: 'هزینه صدور کارت عضویت ویژه چقدر است؟',
        budget: { maxIterations: 2, minConfidenceScore: 25 },
      });

      expect(res.conflictDetected).toBe(true);
      expect(res.actionOutcome).toBe('abstain_conflicting');
      expect(res.iterationsUsed).toBe(0);
    });
  }
);
