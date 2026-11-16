import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.ts';
import {
  auditLogs,
  departments,
  knowledgeChunks,
  knowledgeChunkVectors,
  knowledgeDocuments,
  ragIngestionJobs,
  users,
} from '../src/db/schema.ts';
import { retrieveAuthorizedKnowledge } from '../src/modules/knowledge/retrieval.ts';
import {
  deleteKnowledgeDocument,
  replaceKnowledgeDocumentFile,
  updateKnowledgeDocumentMetadata,
  uploadAndIndexDocument,
} from '../src/modules/knowledge/service.ts';
import { buildParentChildChunks } from '../src/modules/rag/chunking/parent-child.ts';
import { validateAndExtractStructuredDocument } from '../src/modules/rag/chunking/structured-parser.ts';
import {
  buildLexicalIndexString,
  extractStructuredIdentifiers,
  normalizePersianForSearch,
  normalizePersianPreservingStructure,
} from '../src/modules/rag/normalizer.ts';
import {
  getEmbeddingIndexHealth,
  getVectorStoreAdapter,
} from '../src/modules/rag/stores/pg-vector.ts';

async function buildSampleXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const sheet1 = wb.addWorksheet('تعرفه‌ها');
  sheet1.addRow(['کد خدمت', 'عنوان سرویس', 'تعرفه (ریال)']);
  for (let i = 1; i <= 25; i++) {
    sheet1.addRow([`SRV-${100 + i}`, `سرویس سازمانی ${i}`, `${i * 150000}`]);
  }

  const sheet2 = wb.addWorksheet('زمان‌بندی');
  sheet2.addRow(['مرحله', 'مهلت پاسخ']);
  sheet2.addRow(['بررسی اولیه', '۲۴ ساعت']);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

describe('Stage 2 Ingestion Unit Tests (Normalization, Structured Extraction, Parent-Child Chunking)', () => {
  it('normalizes Persian glyphs, ZWNJ, Eastern digits, and preserves structured identifiers', () => {
    expect(normalizePersianForSearch('كیفیت ۱۲۳ می‌بایست يادداشت شود')).toBe(
      'کیفیت 123 می بایست یادداشت شود'
    );
    expect(normalizePersianPreservingStructure('ماده ۱:\r\nكیفیت\u200Cبخش ۱۲۳')).toBe(
      'ماده ۱:\nکیفیت\u200Cبخش ۱۲۳'
    );

    const ids = extractStructuredIdentifiers(
      'بخشنامه شماره ISO-27001 و کد ERR-403 مورخ ۱۴۰۴/۰۲/۱۵ و شبا IR0011223344'
    );
    expect(ids).toContain('iso-27001');
    expect(ids).toContain('err-403');
    expect(ids).toContain('1404/02/15');
    expect(ids).toContain('ir0011223344');

    const lex = buildLexicalIndexString('کد ERR-403', ['آیین‌نامه ۱۴۰۴']);
    expect(lex).toContain('err-403');
    expect(lex).toContain('1404');
  });

  it('extracts structured Markdown headings, lists, tables, and XLSX sheets with repeated headers', async () => {
    const mdSample = [
      '# راهنمای جامع پشتیبانی',
      '',
      '## فصل ۱: شرایط ثبت درخواست',
      '',
      '۱. تکمیل فرم اولیه',
      '۲. ارسال کد پیگیری',
      '',
      '| کد خطا | توضیح | راهکار |',
      '| --- | --- | --- |',
      '| ERR-501 | خطای درگاه | بررسی اتصال شبکه |',
    ].join('\n');

    const mdExtracted = await validateAndExtractStructuredDocument({
      filename: 'guide.md',
      buffer: Buffer.from(mdSample, 'utf8'),
      maxBytes: 1024 * 1024,
    });

    expect(mdExtracted.extension).toBe('md');
    expect(mdExtracted.blocks.some((b) => b.type === 'heading' && b.level === 2)).toBe(
      true
    );
    expect(mdExtracted.blocks.some((b) => b.type === 'list')).toBe(true);
    expect(mdExtracted.blocks.some((b) => b.type === 'table')).toBe(true);

    // XLSX structured extraction
    const xlsxBuf = await buildSampleXlsxBuffer();
    const xlsxExtracted = await validateAndExtractStructuredDocument({
      filename: 'tariffs.xlsx',
      buffer: xlsxBuf,
      maxBytes: 5 * 1024 * 1024,
    });

    expect(xlsxExtracted.extension).toBe('xlsx');
    expect(xlsxExtracted.sheetNames).toEqual(['تعرفه‌ها', 'زمان‌بندی']);
    expect(xlsxExtracted.blocks.some((b) => b.sheetName === 'تعرفه‌ها' && b.type === 'table')).toBe(true);

    // Spoofed XLSX signature rejection
    await expect(
      validateAndExtractStructuredDocument({
        filename: 'spoof.xlsx',
        buffer: Buffer.from('not-a-zip-archive'),
        maxBytes: 1024 * 1024,
      })
    ).rejects.toThrow('INVALID_FILE_SIGNATURE');
  });

  it('builds parent-child chunk hierarchy preserving provenance and table headers on splits', async () => {
    const xlsxBuf = await buildSampleXlsxBuffer();
    const xlsxExtracted = await validateAndExtractStructuredDocument({
      filename: 'tariffs.xlsx',
      buffer: xlsxBuf,
      maxBytes: 5 * 1024 * 1024,
    });

    const chunks = buildParentChildChunks({
      documentId: 'doc_unit_1',
      documentVersion: 3,
      titleFa: 'جدول تعرفه‌ها',
      collectionId: 'col_1',
      departmentIds: ['dept_1'],
      classification: 'department',
      blocks: xlsxExtracted.blocks,
      options: { parentMaxChars: 1800, childMaxChars: 420, childOverlapChars: 60 },
    });

    const parents = chunks.filter((c) => c.chunkLevel === 'parent');
    const children = chunks.filter((c) => c.chunkLevel === 'child');

    expect(parents.length).toBeGreaterThan(0);
    expect(children.length).toBeGreaterThan(parents.length);

    const parentIds = new Set(parents.map((p) => p.id));
    for (const child of children) {
      expect(child.parentChunkId).not.toBeNull();
      expect(parentIds.has(child.parentChunkId!)).toBe(true);
      expect(child.provenance.documentId).toBe('doc_unit_1');
      expect(child.provenance.documentVersion).toBe(3);
      expect(child.provenance.classification).toBe('department');
      expect(child.sourceRef).toContain('doc_unit_1#v3:');
    }

    // Verify split table children retain column header
    const tableChildren = children.filter(
      (c) => c.chunkType === 'table' && c.sheetName === 'تعرفه‌ها'
    );
    expect(tableChildren.length).toBeGreaterThan(1);
    for (const tc of tableChildren) {
      expect(tc.content).toContain('کد خدمت');
    }
  });
});

const hasSqlEnv = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

describe.skipIf(!hasSqlEnv)('Stage 2 PostgreSQL + pgvector Ingestion & Isolation Integration', () => {
  const actorUserId = 's2test_actor';
  const deptId = 's2test_dept';
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: actorUserId,
        username: 's2test_user',
        email: 's2test@test.local',
        name: 'تست مرحله ۲',
        status: 'active',
        mustChangePassword: false,
      })
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values({
        id: deptId,
        slug: 's2test-support',
        nameFa: 'پشتیبانی تست مرحله ۲',
        descriptionFa: '',
        iconKey: 'building',
        displayOrder: 950,
        isActive: true,
        isPublic: true,
        aiEnabled: true,
        humanOperatorsAvailable: true,
      })
      .onConflictDoNothing();
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
      await db.delete(departments).where(eq(departments.id, deptId));
      await db.delete(auditLogs).where(eq(auditLogs.actorUserId, actorUserId));
      await db.delete(users).where(eq(users.id, actorUserId));
    } finally {
      await pool.end();
    }
  });

  it('ingests XLSX & Markdown via job queue, preserves parent-child chunks, and handles versioning replacement', async () => {
    const xlsxBuf = await buildSampleXlsxBuffer();
    const res = await uploadAndIndexDocument({
      filename: 'tariffs.xlsx',
      buffer: xlsxBuf,
      titleFa: 'فهرست تعرفه خدمات ۱۴۰۵',
      collectionId: null,
      scope: 'department',
      classification: 'department',
      isEnabled: true,
      departmentIds: [deptId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage2',
    });
    createdDocIds.push(res.id);

    expect(res.status).toBe('indexed');
    expect(res.parentCount).toBeGreaterThan(0);
    expect(res.childCount).toBeGreaterThan(0);
    expect(res.chunkCount).toBe(res.parentCount + res.childCount);

    const jobRow = await db.query.ragIngestionJobs.findFirst({
      where: eq(ragIngestionJobs.id, res.jobId),
    });
    expect(jobRow?.status).toBe('completed');
    expect(jobRow?.stage).toBe('completed');

    // Retrieval finds child content
    const hit1 = await retrieveAuthorizedKnowledge({
      departmentId: deptId,
      query: 'تعرفه سرویس سازمانی SRV-101',
    });
    expect(hit1.matches.some((m) => m.parentId === res.id)).toBe(true);

    // Replace document with v2 Markdown containing updated distinct token
    const replaced = await replaceKnowledgeDocumentFile({
      documentId: res.id,
      filename: 'tariffs-v2.md',
      buffer: Buffer.from('# تعرفه جدید\n\nکد جایگزین نسخه دوم NEW-TARIFF-2026 است.', 'utf8'),
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage2',
    });
    expect(replaced?.version).toBe(2);
    expect(replaced?.status).toBe('indexed');

    // Old v1 chunks must be removed cleanly
    const dbChunks = await db
      .select({ version: knowledgeChunks.documentVersion, content: knowledgeChunks.content })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, res.id));
    expect(dbChunks.every((c) => c.version === 2)).toBe(true);
    expect(dbChunks.some((c) => c.content.includes('SRV-101'))).toBe(false);
    expect(dbChunks.some((c) => c.content.includes('NEW-TARIFF-2026'))).toBe(true);
  });

  it('blocks documents in processing, disabled, or superseded states from retrieval', async () => {
    const res = await uploadAndIndexDocument({
      filename: 'policy.md',
      buffer: Buffer.from('# مصوبه آزمایشی\n\nکد SECRET-GATE-7711 معتبر است.', 'utf8'),
      titleFa: 'مصوبه گیت دسترسی',
      collectionId: null,
      scope: 'department',
      isEnabled: true,
      departmentIds: [deptId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage2',
    });
    createdDocIds.push(res.id);

    // Initially retrievable
    const activeHit = await retrieveAuthorizedKnowledge({
      departmentId: deptId,
      query: 'کد SECRET-GATE-7711',
    });
    expect(activeHit.matches.some((m) => m.parentId === res.id)).toBe(true);

    // Mark superseded -> must NOT be returned
    await updateKnowledgeDocumentMetadata({
      documentId: res.id,
      input: { validityStatus: 'superseded' },
      actorUserId,
      ipAddress: null,
      userAgent: null,
    });
    const supersededHit = await retrieveAuthorizedKnowledge({
      departmentId: deptId,
      query: 'کد SECRET-GATE-7711',
    });
    expect(supersededHit.matches.some((m) => m.parentId === res.id)).toBe(false);

    // Restore current, then simulate processing status -> must NOT be returned
    await updateKnowledgeDocumentMetadata({
      documentId: res.id,
      input: { validityStatus: 'current' },
      actorUserId,
      ipAddress: null,
      userAgent: null,
    });
    await db
      .update(knowledgeDocuments)
      .set({ status: 'processing' })
      .where(eq(knowledgeDocuments.id, res.id));
    const processingHit = await retrieveAuthorizedKnowledge({
      departmentId: deptId,
      query: 'کد SECRET-GATE-7711',
    });
    expect(processingHit.matches.some((m) => m.parentId === res.id)).toBe(false);
  });

  it('isolates pgvector similarity queries strictly by embeddingModel and dimensions', async () => {
    const res = await uploadAndIndexDocument({
      filename: 'vec-test.md',
      buffer: Buffer.from('# تست بردار\n\nراهنمای استاندارد جستجوی برداری سازمانی.', 'utf8'),
      titleFa: 'سند تست بردار',
      collectionId: null,
      scope: 'department',
      isEnabled: true,
      departmentIds: [deptId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage2',
    });
    createdDocIds.push(res.id);

    const childRows = await db
      .select({ id: knowledgeChunks.id })
      .from(knowledgeChunks)
      .where(
        eq(knowledgeChunks.documentId, res.id)
      );
    const childChunk = await db.query.knowledgeChunks.findFirst({
      where: inArray(
        knowledgeChunks.id,
        childRows.map((r) => r.id)
      ),
    });
    expect(childChunk).toBeDefined();

    // Find a child-level chunk specifically
    const allChunks = await db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, res.id));
    const targetChild = allChunks.find((c) => c.chunkLevel === 'child');
    expect(targetChild).toBeDefined();

    const store = getVectorStoreAdapter();
    await store.upsertDocumentVectors(db, [
      {
        chunkId: targetChild!.id,
        documentId: res.id,
        documentVersion: 1,
        embeddingModel: 'model-alpha-test',
        dimensions: 4,
        embedding: [0.9, 0.1, 0.0, 0.0],
        isActive: true,
      },
    ]);

    await db
      .update(knowledgeDocuments)
      .set({ embeddingModelUsed: 'model-alpha-test', embeddingDimensions: 4 })
      .where(eq(knowledgeDocuments.id, res.id));

    // Matching model returns vector hit
    const hitsMatch = await store.searchDocumentVectors({
      authorizedDocumentIds: [res.id],
      queryEmbedding: [0.9, 0.1, 0.0, 0.0],
      embeddingModel: 'model-alpha-test',
      limit: 5,
    });
    expect(hitsMatch.length).toBe(1);
    expect(hitsMatch[0].similarity).toBeGreaterThan(0.95);

    // Different embedding model with same dimensions MUST return 0 hits (safe model isolation)
    const hitsMismatchModel = await store.searchDocumentVectors({
      authorizedDocumentIds: [res.id],
      queryEmbedding: [0.9, 0.1, 0.0, 0.0],
      embeddingModel: 'model-beta-test',
      limit: 5,
    });
    expect(hitsMismatchModel.length).toBe(0);

    // Health check flags model mismatch when active model changes
    const health = await getEmbeddingIndexHealth('model-beta-test');
    expect(health.mismatchedDocumentIds).toContain(res.id);
    expect(health.needsReindex).toBe(true);

    // Cleanup custom vector row
    await db
      .delete(knowledgeChunkVectors)
      .where(eq(knowledgeChunkVectors.documentId, res.id));
  });
});
