import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.ts';
import {
  auditLogs,
  departments,
  knowledgeChunks,
  knowledgeChunkVectors,
  knowledgeDocuments,
  users,
} from '../src/db/schema.ts';
import {
  deleteKnowledgeDocument,
  uploadAndIndexDocument,
} from '../src/modules/knowledge/service.ts';
import { runAdvancedRetrieval } from '../src/modules/rag/retrieval/engine.ts';
import {
  contextualizeWithHistory,
  decomposeCompoundQuery,
  transformQuery,
} from '../src/modules/rag/retrieval/query-transformer.ts';
import { CrossFeatureReranker } from '../src/modules/rag/retrieval/reranker.ts';
import { fuseWithReciprocalRankFusion } from '../src/modules/rag/retrieval/rrf.ts';
import { selectRetrievalStrategy } from '../src/modules/rag/retrieval/strategy-selector.ts';
import { getVectorStoreAdapter } from '../src/modules/rag/stores/pg-vector.ts';

describe('Stage 3 Unit Tests (RRF, Query Transform, Adaptive Strategy, Reranker)', () => {
  it('fuses lexical and semantic ranked hits cleanly with weighted Reciprocal Rank Fusion', () => {
    const fused = fuseWithReciprocalRankFusion({
      lexicalLists: [
        [
          { sourceType: 'document_chunk', id: 'c1', parentId: 'd1', score: 0.9, rank: 1, matchedBy: 'fts' },
          { sourceType: 'document_chunk', id: 'c2', parentId: 'd1', score: 0.5, rank: 2, matchedBy: 'trgm' },
        ],
      ],
      semanticLists: [
        {
          sourceType: 'document_chunk',
          hits: [
            { id: 'c2', parentId: 'd1', similarity: 0.92, rank: 1, embeddingModel: 'm1' },
            { id: 'c3', parentId: 'd2', similarity: 0.85, rank: 2, embeddingModel: 'm1' },
          ],
        },
      ],
      config: { k: 60, limit: 5 },
    });

    // c2 appeared in BOTH lists (rank 2 lexical + rank 1 semantic) so RRF ranks it #1
    expect(fused[0].id).toBe('c2');
    expect(fused[0].lexicalRank).toBe(2);
    expect(fused[0].semanticRank).toBe(1);
    expect(fused[0].matchedBy).toEqual(expect.arrayContaining(['trgm', 'vector']));
  });

  it('transforms queries with filler removal, contextualization, expansion, and decomposition', async () => {
    const subs = decomposeCompoundQuery(
      'سلام وقت بخیر، مهلت استرداد وجه چقدر است؟ و همچنین شماره شبا شهریه چیست؟'
    );
    expect(subs.length).toBe(2);

    const ctx = contextualizeWithHistory('مهلتش چقدر است؟', [
      { senderRole: 'customer', content: 'شرایط استرداد وجه انصراف از ثبت نام چیست؟' },
    ]);
    expect(ctx.wasContextualized).toBe(true);
    expect(ctx.contextualized).toContain('استرداد');

    const trace = await transformQuery({
      originalQuery: 'لطفاً بفرمایید شهریه و مهلت استرداد وجه چیست؟',
      enableExpansion: true,
      enableDecomposition: true,
    });
    expect(trace.originalQuery).toContain('شهریه');
    expect(trace.generatedQueries.length).toBeGreaterThanOrEqual(2);
  });

  it('selects adaptive retrieval strategy based on query characteristics', () => {
    expect(
      selectRetrievalStrategy({
        query: 'کد ERR-403 چیست؟',
        hasEmbeddingModel: true,
      }).strategy
    ).toBe('direct_lexical');

    expect(
      selectRetrievalStrategy({
        query: 'مهلت استرداد چقدر است؟ و همچنین شماره شبا کدام است؟',
        hasEmbeddingModel: true,
      }).strategy
    ).toBe('decomposed');

    expect(
      selectRetrievalStrategy({
        query: 'مهلتش چنده',
        conversationHistory: [{ senderRole: 'customer', content: 'استرداد وجه' }],
        hasEmbeddingModel: true,
      }).strategy
    ).toBe('multi_query');

    expect(
      selectRetrievalStrategy({
        query: 'شرایط دقیق ثبت نام و تحویل مدارک آموزشی در سامانه جدید',
        hasEmbeddingModel: true,
      }).strategy
    ).toBe('hybrid');
  });

  it('reranks candidates independently from raw RRF prior using CrossFeatureReranker', async () => {
    const reranker = new CrossFeatureReranker();
    const ranked = await reranker.rerank({
      query: 'کد خطا ERR-502 درگاه پرداخت',
      candidates: [
        {
          key: 'document_chunk:a',
          sourceType: 'document_chunk',
          sourceId: 'a',
          parentId: 'd1',
          title: 'راهنمای عمومی',
          headingPath: null,
          sectionTitle: null,
          content: 'برای ثبت درخواست پشتیبانی ابتدا وارد پنل کاربری شوید.',
          chunkType: 'text',
          initialScore: 80,
          rerankScore: 80,
          rerankMethod: 'none',
        },
        {
          key: 'document_chunk:b',
          sourceType: 'document_chunk',
          sourceId: 'b',
          parentId: 'd1',
          title: 'جدول خطاهای درگاه پرداخت',
          headingPath: 'خطاهای درگاه پرداخت',
          sectionTitle: 'خطاهای درگاه پرداخت',
          content: 'کد خطا ERR-502 مربوط به اختلال موقت درگاه پرداخت است و پس از ۵ دقیقه برطرف می‌شود.',
          chunkType: 'table',
          initialScore: 60,
          rerankScore: 60,
          rerankMethod: 'none',
        },
      ],
      limit: 2,
    });

    expect(ranked[0].sourceId).toBe('b');
    expect(ranked[0].rerankMethod).toBe('cross_feature');
    expect(ranked[0].rerankScore).toBeGreaterThan(ranked[1].rerankScore);
  });
});

const hasSqlEnv = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

describe.skipIf(!hasSqlEnv)('Stage 3 Hybrid RRF + Parent-Child + Dept Isolation Integration', () => {
  const actorUserId = 's3test_actor';
  const deptAId = 's3test_dept_a';
  const deptBId = 's3test_dept_b';
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: actorUserId,
        username: 's3test_user',
        email: 's3test@test.local',
        name: 'تست مرحله ۳',
        status: 'active',
        mustChangePassword: false,
      })
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values([
        {
          id: deptAId,
          slug: 's3test-fin',
          nameFa: 'مالی تست ۳',
          descriptionFa: '',
          iconKey: 'building',
          displayOrder: 960,
          isActive: true,
          isPublic: true,
          aiEnabled: true,
          humanOperatorsAvailable: true,
        },
        {
          id: deptBId,
          slug: 's3test-sec',
          nameFa: 'امنیت تست ۳',
          descriptionFa: '',
          iconKey: 'shield',
          displayOrder: 961,
          isActive: true,
          isPublic: true,
          aiEnabled: true,
          humanOperatorsAvailable: false,
        },
      ])
      .onConflictDoNothing();

    // Dept A long regulatory doc with multiple child chunks under one parent section
    const longRegulation = [
      '# آیین‌نامه استرداد و تسویه حساب',
      '',
      '## فصل اول: ضوابط عودت وجه',
      '',
      'بند ۱: متقاضی باید فرم شماره FRM-902 را تکمیل کند.',
      '',
      'بند ۲: ' + 'شرح جزئیات اداری بررسی پرونده توسط کارشناس مالی در این بند درج شده است. '.repeat(14),
      '',
      'بند ۳: سقف زمانی واریز نهایی مبلغ مصوب پس از تایید، حداکثر ۱۰ روز کاری به شماره شبا متقاضی است.',
    ].join('\n');

    const docA = await uploadAndIndexDocument({
      filename: 'refund-reg.md',
      buffer: Buffer.from(longRegulation, 'utf8'),
      titleFa: 'آیین‌نامه استرداد و تسویه',
      collectionId: null,
      scope: 'department',
      classification: 'department',
      isEnabled: true,
      departmentIds: [deptAId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage3',
    });
    createdDocIds.push(docA.id);

    // Dept B private doc (must NEVER leak to Dept A)
    const docB = await uploadAndIndexDocument({
      filename: 'sec-only.md',
      buffer: Buffer.from('# کلید محرمانه\n\nرمز عبور سرور SEC-ALPHA-4499 است.', 'utf8'),
      titleFa: 'سند محرمانه امنیت',
      collectionId: null,
      scope: 'department',
      classification: 'department',
      isEnabled: true,
      departmentIds: [deptBId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage3',
    });
    createdDocIds.push(docB.id);
  });

  afterAll(async () => {
    try {
      for (const id of createdDocIds) {
        await deleteKnowledgeDocument({
          documentId: id,
          actorUserId,
          ipAddress: null,
          userAgent: null,
        });
      }
      await db.delete(departments).where(eq(departments.id, deptAId));
      await db.delete(departments).where(eq(departments.id, deptBId));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, actorUserId));
      await db.delete(users).where(eq(users.id, actorUserId));
    } finally {
      await pool.end();
    }
  });

  it('retrieves child chunks via RRF, expands parent section context, and isolates departments', async () => {
    // Attach mock semantic vector to a Dept A child chunk so hybrid RRF exercises both pg_fts and pgvector
    const docAId = createdDocIds[0];
    const chunks = await db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, docAId));
    const childWithTenDays = chunks.find(
      (c) => c.chunkLevel === 'child' && c.content.includes('۱۰ روز کاری')
    );
    expect(childWithTenDays).toBeDefined();

    await getVectorStoreAdapter().upsertDocumentVectors(db, [
      {
        chunkId: childWithTenDays!.id,
        documentId: docAId,
        documentVersion: 1,
        embeddingModel: 'stage3-test-embed',
        dimensions: 4,
        embedding: [0.85, 0.15, 0.0, 0.0],
        isActive: true,
      },
    ]);
    await db
      .update(knowledgeDocuments)
      .set({ embeddingModelUsed: 'stage3-test-embed', embeddingDimensions: 4 })
      .where(eq(knowledgeDocuments.id, docAId));

    const result = await runAdvancedRetrieval({
      departmentId: deptAId,
      query: 'فرم شماره FRM-902 و سقف زمانی واریز نهایی مبلغ چقدر است؟',
      embeddingModel: 'stage3-test-embed',
      queryEmbedding: [0.85, 0.15, 0.0, 0.0],
      enableParentExpansion: true,
      finalLimit: 3,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].parentId).toBe(docAId);
    expect(result.matches[0].expandedFromParent).toBe(true);
    // Expanded parent context contains BOTH Band 1 (FRM-902) AND Band 3 (۱۰ روز کاری) from the same section!
    expect(result.matches[0].content).toContain('FRM-902');
    expect(result.matches[0].content).toContain('۱۰ روز کاری');
    expect(result.trace.semanticDocHitCount).toBeGreaterThan(0);
    expect(result.trace.lexicalDocHitCount).toBeGreaterThan(0);

    // Cross-department isolation check
    const crossDept = await runAdvancedRetrieval({
      departmentId: deptAId,
      query: 'SEC-ALPHA-4499 رمز عبور سرور',
      embeddingModel: 'stage3-test-embed',
      queryEmbedding: [0.85, 0.15, 0.0, 0.0],
    });
    expect(
      crossDept.matches.some((m) => m.content.includes('SEC-ALPHA-4499'))
    ).toBe(false);

    await db
      .delete(knowledgeChunkVectors)
      .where(eq(knowledgeChunkVectors.documentId, docAId));
  });
});
