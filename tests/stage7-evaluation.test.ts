import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/index.ts';
import {
  auditLogs,
  departments,
  ragEvaluationRuns,
  users,
} from '../src/db/schema.ts';
import {
  deleteKnowledgeDocument,
  replaceKnowledgeDocumentFile,
  uploadAndIndexDocument,
} from '../src/modules/knowledge/service.ts';
import {
  computeIrMetrics,
  listRagEvaluationRuns,
  runBuiltInRagEvaluationSuite,
} from '../src/modules/rag/evaluation/suite.ts';
import { runAdvancedRetrieval } from '../src/modules/rag/retrieval/engine.ts';

describe('Stage 7 IR Evaluation Metrics Unit Tests', () => {
  it('computes accurate Recall@K, Precision@K, MRR, and nDCG', () => {
    const perfect = computeIrMetrics(['سند الف', 'سند ب'], ['سند الف'], 5);
    expect(perfect.recallAtK).toBe(1);
    expect(perfect.mrr).toBe(1);
    expect(perfect.ndcg).toBe(1);

    const rankedSecond = computeIrMetrics(
      ['سند نامرتبط', 'آیین‌نامه مرخصی', 'سند سوم'],
      ['آیین‌نامه مرخصی', 'بخشنامه غایب'],
      5
    );
    expect(rankedSecond.recallAtK).toBe(0.5);
    expect(rankedSecond.precisionAtK).toBeCloseTo(0.333, 2);
    expect(rankedSecond.mrr).toBe(0.5);
    expect(rankedSecond.ndcg).toBeGreaterThan(0.3);
    expect(rankedSecond.ndcg).toBeLessThan(0.8);

    const miss = computeIrMetrics(['سند دیگر'], ['سند هدف'], 5);
    expect(miss.recallAtK).toBe(0);
    expect(miss.mrr).toBe(0);
    expect(miss.ndcg).toBe(0);
  });
});

const hasSqlEnv = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

describe.skipIf(!hasSqlEnv)('Stage 7 Full 8-Category RAG Evaluation & Acceptance Scenarios (PostgreSQL)', () => {
  const actorUserId = 's7test_actor';
  const deptId = 's7test_dept';
  const createdRunIds: string[] = [];
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: actorUserId,
        username: 's7test_user',
        email: 's7test@test.local',
        name: 'ارزیاب مرحله ۷',
        status: 'active',
        mustChangePassword: false,
      })
      .onConflictDoNothing();

    await db
      .insert(departments)
      .values({
        id: deptId,
        slug: 's7test-ops',
        nameFa: 'عملیات تست مرحله ۷',
        descriptionFa: 'دپارتمان تست جایگزینی نسخه و اکسل',
        iconKey: 'building',
        displayOrder: 970,
        isActive: true,
        isPublic: true,
        aiEnabled: true,
        humanOperatorsAvailable: true,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    try {
      for (const runId of createdRunIds) {
        await db.delete(ragEvaluationRuns).where(eq(ragEvaluationRuns.id, runId));
      }
      for (const docId of createdDocIds) {
        await deleteKnowledgeDocument({
          documentId: docId,
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

  it('executes the 8-category RAG evaluation benchmark, persists metrics, and cleans sandbox fixtures', async () => {
    const label = `تست خودکار بنچمارک ${randomUUID().slice(0, 6)}`;
    const report = await runBuiltInRagEvaluationSuite({
      triggeredByUserId: actorUserId,
      runLabel: label,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage7',
    });
    createdRunIds.push(report.id);

    expect(report.totalCases).toBe(8);
    expect(report.results.filter((r) => !r.passed)).toEqual([]);
    expect(report.passedCases).toBe(8);
    expect(report.recallAtK).toBeGreaterThanOrEqual(0.8);
    expect(report.mrr).toBeGreaterThanOrEqual(0.75);
    expect(report.abstentionAccuracyRate).toBe(1);
    expect(report.citationCorrectnessRate).toBe(1);
    expect(report.unsupportedClaimRate).toBe(0);

    const recentRuns = await listRagEvaluationRuns(10);
    expect(recentRuns.some((r) => r.id === report.id && r.runLabel === label)).toBe(true);

    // Confirm temporary evaluation departments were cleaned up
    const remainingEvalDepts = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.nameFa, 'دپارتمان ارزیابی پشتیبانی'));
    expect(remainingEvalDepts.length).toBe(0);
  });

  it('preserves XLSX numeric table cells accurately and invalidates replaced document v1 immediately', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('جدول تعرفه');
    sheet.addRow(['کد خدمت', 'عنوان سرویس', 'تعرفه پایه']);
    sheet.addRow(['SRV-905', 'پشتیبانی ویژه سازمانی', '۴۸۰۰۰۰۰ ریال']);
    sheet.addRow(['SRV-906', 'گزارش تحلیلی ماهیانه', '۱۲۰۰۰۰۰ ریال']);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const v1 = await uploadAndIndexDocument({
      filename: 'service-tariffs.xlsx',
      buffer: xlsxBuf,
      titleFa: 'جدول تعرفه سرویس‌های سازمانی',
      collectionId: null,
      scope: 'department',
      classification: 'department',
      validityStatus: 'current',
      isEnabled: true,
      departmentIds: [deptId],
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage7',
    });
    createdDocIds.push(v1.id);

    const xlsxRetrieval = await runAdvancedRetrieval({
      departmentId: deptId,
      query: 'تعرفه پایه کد خدمت SRV-905 چقدر است؟',
      rerankerMode: 'cross_feature',
    });
    expect(xlsxRetrieval.matches.length).toBeGreaterThan(0);
    expect(xlsxRetrieval.matches[0].content).toContain('SRV-905');
    expect(xlsxRetrieval.matches[0].sheetName).toBe('جدول تعرفه');

    // Replace doc with v2 containing new versioned rule and obsolete marker removal
    const v2 = await replaceKnowledgeDocumentFile({
      documentId: v1.id,
      filename: 'service-tariffs-v2.md',
      buffer: Buffer.from(
        '# نسخه دوم جدول تعرفه\nتعرفه جدید سرویس کد SRV-905 برابر ۵۵۰۰۰۰۰ ریال به‌روزرسانی شد.',
        'utf8'
      ),
      actorUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-stage7',
    });
    expect(v2).not.toBeNull();
    expect(v2!.version).toBe(2);

    const afterReplace = await runAdvancedRetrieval({
      departmentId: deptId,
      query: 'تعرفه جدید سرویس کد SRV-905',
      rerankerMode: 'cross_feature',
    });
    expect(afterReplace.matches.length).toBeGreaterThan(0);
    expect(afterReplace.matches[0].documentVersion).toBe(2);
    expect(afterReplace.matches[0].content).toContain('۵۵۰۰۰۰۰');
    expect(afterReplace.matches.some((m) => m.content.includes('۴۸۰۰۰۰۰'))).toBe(false);
  });
});
