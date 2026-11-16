import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  knowledgeChunks,
  knowledgeDocumentDepartments,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  ragIngestionJobs,
} from '@/src/db/schema.ts';
import { createAiProviderAdapter } from '../../ai/provider.ts';
import { getInternalAiProviderRuntimeConfig } from '../../ai/settings.ts';
import { buildParentChildChunks } from '../chunking/parent-child.ts';
import { validateAndExtractStructuredDocument } from '../chunking/structured-parser.ts';
import { getVectorStoreAdapter } from '../stores/pg-vector.ts';
import type {
  DocumentClassification,
  IngestionJobType,
  IngestionStage,
} from '../types.ts';

const MAX_KB_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB
const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 minutes

let backgroundDraining = false;

async function updateJobAndDocumentStage(params: {
  jobId: string;
  documentId: string;
  stage: IngestionStage;
  processedChunks?: number;
  totalChunks?: number;
  embeddingModel?: string | null;
}) {
  const now = new Date();
  await Promise.all([
    db
      .update(ragIngestionJobs)
      .set({
        stage: params.stage,
        ...(params.processedChunks !== undefined
          ? { processedChunks: params.processedChunks }
          : {}),
        ...(params.totalChunks !== undefined
          ? { totalChunks: params.totalChunks }
          : {}),
        ...(params.embeddingModel !== undefined
          ? { embeddingModel: params.embeddingModel }
          : {}),
        updatedAt: now,
      })
      .where(eq(ragIngestionJobs.id, params.jobId)),
    db
      .update(knowledgeDocuments)
      .set({
        ingestionStage: params.stage,
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, params.documentId)),
  ]);
}

async function generateChunkEmbeddingsSafe(
  chunks: ReturnType<typeof buildParentChildChunks>
): Promise<{
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  vectorsByChunkId: Map<string, number[]>;
}> {
  const vectorsByChunkId = new Map<string, number[]>();
  const config = await getInternalAiProviderRuntimeConfig();
  if (!config.embeddingModel || !config.apiKey) {
    return { embeddingModel: null, embeddingDimensions: null, vectorsByChunkId };
  }

  const adapter = createAiProviderAdapter(config);
  let detectedDim: number | null = null;

  // Only embed child chunks for fine-grained semantic matching (parents are expanded at retrieval time)
  const childChunks = chunks.filter((c) => c.chunkLevel === 'child');

  for (const ch of childChunks) {
    try {
      const vec = await adapter.generateEmbedding(ch.content.slice(0, 6000));
      if (vec && vec.length > 0) {
        if (detectedDim === null) detectedDim = vec.length;
        if (vec.length === detectedDim) {
          vectorsByChunkId.set(ch.id, vec);
        }
      }
    } catch (err) {
      logger.warn('rag.ingestion.embedding_chunk_failed', {
        chunkId: ch.id,
        error: err instanceof Error ? err.message : 'EMBEDDING_ERROR',
      });
    }
  }

  return {
    embeddingModel: vectorsByChunkId.size > 0 ? config.embeddingModel : null,
    embeddingDimensions: vectorsByChunkId.size > 0 ? detectedDim : null,
    vectorsByChunkId,
  };
}

export async function enqueueDocumentIngestionJob(params: {
  documentId: string;
  jobType: IngestionJobType;
  targetVersion: number;
  triggeredByUserId: string | null;
  payloadJson?: Record<string, unknown>;
}) {
  const jobId = `rjob_${randomUUID()}`;
  const [job] = await db
    .insert(ragIngestionJobs)
    .values({
      id: jobId,
      documentId: params.documentId,
      jobType: params.jobType,
      status: 'pending',
      stage: 'queued',
      targetVersion: params.targetVersion,
      attempts: 0,
      maxAttempts: 3,
      payloadJson: params.payloadJson ?? {},
      triggeredByUserId: params.triggeredByUserId,
    })
    .returning();
  return job;
}

export async function runIngestionJobById(jobId: string): Promise<{
  ok: boolean;
  documentId: string;
  status: string;
  chunkCount: number;
  parentCount: number;
  childCount: number;
  embeddingModel: string | null;
}> {
  const job = await db.query.ragIngestionJobs.findFirst({
    where: eq(ragIngestionJobs.id, jobId),
  });
  if (!job) {
    throw new Error('INGESTION_JOB_NOT_FOUND');
  }

  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, job.documentId),
  });
  if (!doc) {
    await db
      .update(ragIngestionJobs)
      .set({
        status: 'failed',
        stage: 'failed',
        errorCode: 'DOCUMENT_NOT_FOUND',
        errorMessage: 'سند مرتبط با این کار یافت نشد.',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ragIngestionJobs.id, jobId));
    throw new Error('DOCUMENT_NOT_FOUND');
  }

  const startedAt = new Date();
  await db
    .update(ragIngestionJobs)
    .set({
      status: 'running',
      stage: 'validating',
      attempts: job.attempts + 1,
      startedAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: startedAt,
    })
    .where(eq(ragIngestionJobs.id, jobId));

  try {
    // 1. Load & validate physical file from storage
    await updateJobAndDocumentStage({
      jobId,
      documentId: doc.id,
      stage: 'extracting',
    });

    const buffer = await getStorageDriver().get(doc.storageKey);
    const extracted = await validateAndExtractStructuredDocument({
      filename: doc.originalFilename,
      buffer,
      maxBytes: MAX_KB_DOCUMENT_BYTES,
    });

    // 2. Normalization & Structure-Aware Parent-Child Chunking
    await updateJobAndDocumentStage({
      jobId,
      documentId: doc.id,
      stage: 'normalizing',
    });

    const deptLinks = await db
      .select({ departmentId: knowledgeDocumentDepartments.departmentId })
      .from(knowledgeDocumentDepartments)
      .where(eq(knowledgeDocumentDepartments.documentId, doc.id));

    await updateJobAndDocumentStage({
      jobId,
      documentId: doc.id,
      stage: 'chunking',
    });

    const classification = (
      doc.classification === 'public_org' ||
      doc.classification === 'internal_restricted'
        ? doc.classification
        : 'department'
    ) as DocumentClassification;

    const targetVersion = job.targetVersion || doc.version;
    const chunkDrafts = buildParentChildChunks({
      documentId: doc.id,
      documentVersion: targetVersion,
      titleFa: doc.titleFa,
      collectionId: doc.collectionId,
      departmentIds: deptLinks.map((d) => d.departmentId),
      classification,
      blocks: extracted.blocks,
      fallbackText: extracted.extractedText,
    });

    if (chunkDrafts.length === 0) {
      throw new Error('EXTRACTED_TEXT_EMPTY');
    }

    // 3. Embedding generation (outside DB transaction!)
    await updateJobAndDocumentStage({
      jobId,
      documentId: doc.id,
      stage: 'embedding',
      totalChunks: chunkDrafts.length,
    });

    const embeddingBatch = await generateChunkEmbeddingsSafe(chunkDrafts);

    // 4. Atomic lexical + vector indexing commit
    await updateJobAndDocumentStage({
      jobId,
      documentId: doc.id,
      stage: 'indexing',
      totalChunks: chunkDrafts.length,
      processedChunks: chunkDrafts.length,
      embeddingModel: embeddingBatch.embeddingModel,
    });

    const isDocActiveForSearch =
      doc.isEnabled &&
      doc.scope !== 'restricted' &&
      doc.validityStatus === 'current';
    const finalDocStatus = doc.isEnabled ? 'indexed' : 'disabled';
    const vectorStore = getVectorStoreAdapter();
    const now = new Date();

    await db.transaction(async (tx) => {
      // Deactivate and delete obsolete chunks & vectors cleanly
      await vectorStore.deleteDocumentVectors(tx, doc.id);
      await tx
        .delete(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, doc.id));

      for (const ch of chunkDrafts) {
        const vec = embeddingBatch.vectorsByChunkId.get(ch.id) ?? null;
        await tx.insert(knowledgeChunks).values({
          id: ch.id,
          documentId: doc.id,
          documentVersion: targetVersion,
          parentChunkId: ch.parentChunkId,
          chunkLevel: ch.chunkLevel,
          chunkIndex: ch.chunkIndex,
          headingPath: ch.headingPath,
          sectionTitle: ch.sectionTitle,
          pageNumber: ch.pageNumber,
          sheetName: ch.sheetName,
          chunkType: ch.chunkType,
          classification: ch.classification,
          sourceRef: ch.sourceRef,
          isActive: isDocActiveForSearch,
          content: ch.content,
          normalizedContent: ch.normalizedContent,
          tokenEstimate: ch.tokenEstimate,
          metadataJson: {
            ...ch.provenance,
          },
          embeddingJson: vec,
          embeddingModel: vec ? embeddingBatch.embeddingModel : null,
          embeddingDimensions: vec ? embeddingBatch.embeddingDimensions : null,
          searchTsv: sql`to_tsvector('simple', ${ch.normalizedContent})`,
          indexedAt: now,
        });
      }

      if (
        embeddingBatch.embeddingModel &&
        embeddingBatch.embeddingDimensions &&
        embeddingBatch.vectorsByChunkId.size > 0
      ) {
        const vectorRecords = chunkDrafts
          .filter((ch) => embeddingBatch.vectorsByChunkId.has(ch.id))
          .map((ch) => ({
            chunkId: ch.id,
            documentId: doc.id,
            documentVersion: targetVersion,
            embeddingModel: embeddingBatch.embeddingModel!,
            dimensions: embeddingBatch.embeddingDimensions!,
            embedding: embeddingBatch.vectorsByChunkId.get(ch.id)!,
            isActive: isDocActiveForSearch,
          }));

        await vectorStore.upsertDocumentVectors(tx, vectorRecords);
      }

      await tx
        .update(knowledgeDocuments)
        .set({
          extractedText: extracted.extractedText,
          chunkCount: chunkDrafts.length,
          status: finalDocStatus,
          ingestionStage: 'completed',
          embeddingModelUsed: embeddingBatch.embeddingModel,
          embeddingDimensions: embeddingBatch.embeddingDimensions,
          errorMessage: null,
          lastIndexedAt: now,
          updatedAt: now,
        })
        .where(eq(knowledgeDocuments.id, doc.id));

      await tx
        .update(knowledgeDocumentVersions)
        .set({ status: finalDocStatus })
        .where(
          and(
            eq(knowledgeDocumentVersions.documentId, doc.id),
            eq(knowledgeDocumentVersions.version, targetVersion)
          )
        );

      await tx
        .update(ragIngestionJobs)
        .set({
          status: 'completed',
          stage: 'completed',
          totalChunks: chunkDrafts.length,
          processedChunks: chunkDrafts.length,
          embeddingModel: embeddingBatch.embeddingModel,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(ragIngestionJobs.id, jobId));
    });

    const parentCount = chunkDrafts.filter((c) => c.chunkLevel === 'parent').length;
    const childCount = chunkDrafts.filter((c) => c.chunkLevel === 'child').length;

    logger.info('rag.ingestion.completed', {
      jobId,
      documentId: doc.id,
      version: targetVersion,
      chunkCount: chunkDrafts.length,
      parentCount,
      childCount,
      embeddingModel: embeddingBatch.embeddingModel,
    });

    return {
      ok: true,
      documentId: doc.id,
      status: finalDocStatus,
      chunkCount: chunkDrafts.length,
      parentCount,
      childCount,
      embeddingModel: embeddingBatch.embeddingModel,
    };
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INGESTION_FAILED';
    const now = new Date();
    const shouldFailDoc = job.jobType === 'ingest' || job.jobType === 'reprocess';

    await db
      .update(ragIngestionJobs)
      .set({
        status: 'failed',
        stage: 'failed',
        errorCode: code.slice(0, 80),
        errorMessage: code,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(ragIngestionJobs.id, jobId));

    if (shouldFailDoc) {
      await db
        .update(knowledgeDocuments)
        .set({
          status: 'failed',
          ingestionStage: 'failed',
          errorMessage: code,
          updatedAt: now,
        })
        .where(eq(knowledgeDocuments.id, doc.id));

      // Ensure failed documents never expose half-baked chunks
      await db
        .update(knowledgeChunks)
        .set({ isActive: false })
        .where(eq(knowledgeChunks.documentId, doc.id));
      await getVectorStoreAdapter().deactivateDocumentVectors(db, doc.id);
    }

    logger.error('rag.ingestion.failed', {
      jobId,
      documentId: doc.id,
      jobType: job.jobType,
      errorCode: code,
    });

    throw err;
  }
}

export async function recoverStaleRunningJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const stale = await db
    .update(ragIngestionJobs)
    .set({
      status: 'pending',
      stage: 'queued',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ragIngestionJobs.status, 'running'),
        lt(ragIngestionJobs.startedAt, cutoff)
      )
    )
    .returning({ id: ragIngestionJobs.id });
  return stale.length;
}

export async function processPendingIngestionJobs(limit = 5): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  await recoverStaleRunningJobs();

  const pendingJobs = await db
    .select({ id: ragIngestionJobs.id })
    .from(ragIngestionJobs)
    .where(eq(ragIngestionJobs.status, 'pending'))
    .orderBy(ragIngestionJobs.createdAt)
    .limit(limit);

  let succeeded = 0;
  let failed = 0;

  for (const item of pendingJobs) {
    try {
      await runIngestionJobById(item.id);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return {
    processed: pendingJobs.length,
    succeeded,
    failed,
  };
}

export function scheduleBackgroundIngestionWorker(): void {
  if (backgroundDraining) return;
  backgroundDraining = true;

  setTimeout(() => {
    void processPendingIngestionJobs(10)
      .catch((err) => {
        logger.error('rag.ingestion.worker_cycle_failed', {
          error: err instanceof Error ? err.message : 'WORKER_ERROR',
        });
      })
      .finally(() => {
        backgroundDraining = false;
      });
  }, 25);
}

export async function listIngestionJobsAdmin(limit = 40) {
  const [jobs, docs] = await Promise.all([
    db
      .select()
      .from(ragIngestionJobs)
      .orderBy(desc(ragIngestionJobs.createdAt))
      .limit(limit),
    db
      .select({
        id: knowledgeDocuments.id,
        titleFa: knowledgeDocuments.titleFa,
        originalFilename: knowledgeDocuments.originalFilename,
      })
      .from(knowledgeDocuments),
  ]);

  const docMap = new Map(docs.map((d) => [d.id, d]));
  return jobs.map((j) => {
    const doc = docMap.get(j.documentId);
    return {
      ...j,
      documentTitleFa: doc?.titleFa || j.documentId,
      originalFilename: doc?.originalFilename || '',
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    };
  });
}

export async function enqueueBulkReindexJobs(params: {
  actorUserId: string;
  onlyMismatchedModel?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.isEnabled, true));

  const targets = params.onlyMismatchedModel
    ? docs.filter(
        (d) =>
          d.status === 'indexed' &&
          d.embeddingModelUsed !== params.onlyMismatchedModel
      )
    : docs.filter((d) => d.status !== 'failed');

  const queuedIds: string[] = [];
  for (const doc of targets) {
    const job = await enqueueDocumentIngestionJob({
      documentId: doc.id,
      jobType: 'reindex_embeddings',
      targetVersion: doc.version,
      triggeredByUserId: params.actorUserId,
      payloadJson: {
        reason: params.onlyMismatchedModel
          ? 'embedding_model_mismatch'
          : 'manual_reindex',
      },
    });
    queuedIds.push(job.id);
  }

  if (queuedIds.length > 0) {
    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: 'kb.documents.reindex_enqueued',
      targetType: 'knowledge_document',
      targetId: queuedIds[0],
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: { jobCount: queuedIds.length },
    });
    scheduleBackgroundIngestionWorker();
  }

  return { queuedCount: queuedIds.length, jobIds: queuedIds };
}
