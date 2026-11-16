import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  departmentKnowledgeCollections,
  departments,
  knowledgeChunks,
  knowledgeChunkVectors,
  knowledgeCollections,
  knowledgeDocumentDepartments,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgeQaDepartments,
  knowledgeQaEntries,
  knowledgeQaVectors,
} from '@/src/db/schema.ts';
import { createAiProviderAdapter } from '../ai/provider.ts';
import { getInternalAiProviderRuntimeConfig } from '../ai/settings.ts';
import { validateAndExtractStructuredDocument } from '../rag/chunking/structured-parser.ts';
import {
  enqueueDocumentIngestionJob,
  runIngestionJobById,
  scheduleBackgroundIngestionWorker,
} from '../rag/jobs/ingestion-worker.ts';
import {
  buildLexicalIndexString,
  normalizePersianForSearch,
} from '../rag/normalizer.ts';
import { getVectorStoreAdapter } from '../rag/stores/pg-vector.ts';
import type { DocumentClassification, DocumentValidityStatus } from '../rag/types.ts';

const MAX_KB_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

async function tryComputeEmbeddingWithModel(text: string): Promise<{
  embedding: number[] | null;
  embeddingModel: string | null;
  dimensions: number | null;
}> {
  try {
    const config = await getInternalAiProviderRuntimeConfig();
    if (!config.embeddingModel || !config.apiKey) {
      return { embedding: null, embeddingModel: null, dimensions: null };
    }
    const adapter = createAiProviderAdapter(config);
    const embedding = await adapter.generateEmbedding(text.slice(0, 6000));
    if (!embedding || embedding.length === 0) {
      return { embedding: null, embeddingModel: null, dimensions: null };
    }
    return {
      embedding,
      embeddingModel: config.embeddingModel,
      dimensions: embedding.length,
    };
  } catch {
    return { embedding: null, embeddingModel: null, dimensions: null };
  }
}

function resolveDefaultClassification(
  scope: 'global' | 'department' | 'restricted',
  explicit?: DocumentClassification
): DocumentClassification {
  if (explicit) return explicit;
  if (scope === 'global') return 'public_org';
  if (scope === 'restricted') return 'internal_restricted';
  return 'department';
}

export async function listKnowledgeCollectionsAdmin() {
  const [cols, deptLinks] = await Promise.all([
    db.select().from(knowledgeCollections).orderBy(asc(knowledgeCollections.createdAt)),
    db
      .select({
        collectionId: departmentKnowledgeCollections.collectionId,
        departmentId: departments.id,
        nameFa: departments.nameFa,
      })
      .from(departmentKnowledgeCollections)
      .innerJoin(departments, eq(departmentKnowledgeCollections.departmentId, departments.id)),
  ]);

  return cols.map((c) => ({
    ...c,
    departments: deptLinks.filter((d) => d.collectionId === c.id),
  }));
}

export async function createKnowledgeCollection(params: {
  input: {
    slug: string;
    nameFa: string;
    descriptionFa: string;
    scope: 'global' | 'department' | 'restricted';
    isActive: boolean;
    departmentIds: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const id = `col_${randomUUID()}`;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(knowledgeCollections)
      .values({
        id,
        slug: params.input.slug,
        nameFa: params.input.nameFa,
        descriptionFa: params.input.descriptionFa,
        scope: params.input.scope,
        isActive: params.input.isActive,
        createdBy: params.actorUserId,
      })
      .returning();

    if (params.input.departmentIds.length > 0) {
      const validDepts = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(inArray(departments.id, params.input.departmentIds));
      for (const d of validDepts) {
        await tx.insert(departmentKnowledgeCollections).values({
          departmentId: d.id,
          collectionId: id,
          assignedBy: params.actorUserId,
        });
      }
    }

    return row;
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.collection.created',
    targetType: 'knowledge_collection',
    targetId: created.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { slug: created.slug, scope: created.scope },
  });

  return created;
}

export async function updateKnowledgeCollection(params: {
  id: string;
  input: Partial<{
    slug: string;
    nameFa: string;
    descriptionFa: string;
    scope: 'global' | 'department' | 'restricted';
    isActive: boolean;
    departmentIds: string[];
  }>;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.knowledgeCollections.findFirst({
    where: eq(knowledgeCollections.id, params.id),
  });
  if (!existing) return null;

  await db.transaction(async (tx) => {
    const { departmentIds, ...fields } = params.input;
    if (Object.keys(fields).length > 0) {
      await tx
        .update(knowledgeCollections)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(knowledgeCollections.id, params.id));
    }

    if (departmentIds !== undefined) {
      await tx
        .delete(departmentKnowledgeCollections)
        .where(eq(departmentKnowledgeCollections.collectionId, params.id));
      if (departmentIds.length > 0) {
        const validDepts = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(inArray(departments.id, departmentIds));
        for (const d of validDepts) {
          await tx.insert(departmentKnowledgeCollections).values({
            departmentId: d.id,
            collectionId: params.id,
            assignedBy: params.actorUserId,
          });
        }
      }
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.collection.updated',
    targetType: 'knowledge_collection',
    targetId: params.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { updated: true },
  });

  return true;
}

export async function listKnowledgeDocumentsAdmin() {
  const [docs, deptLinks] = await Promise.all([
    db.select().from(knowledgeDocuments).orderBy(desc(knowledgeDocuments.createdAt)),
    db
      .select({
        documentId: knowledgeDocumentDepartments.documentId,
        departmentId: departments.id,
        nameFa: departments.nameFa,
      })
      .from(knowledgeDocumentDepartments)
      .innerJoin(departments, eq(knowledgeDocumentDepartments.departmentId, departments.id)),
  ]);

  return docs.map((doc) => ({
    id: doc.id,
    collectionId: doc.collectionId,
    titleFa: doc.titleFa,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    fileExtension: doc.fileExtension,
    byteSize: doc.byteSize,
    scope: doc.scope,
    classification: doc.classification,
    status: doc.status,
    ingestionStage: doc.ingestionStage,
    validityStatus: doc.validityStatus,
    supersededByDocId: doc.supersededByDocId,
    embeddingModelUsed: doc.embeddingModelUsed,
    embeddingDimensions: doc.embeddingDimensions,
    isEnabled: doc.isEnabled,
    version: doc.version,
    chunkCount: doc.chunkCount,
    errorMessage: doc.errorMessage,
    extractedTextPreview: doc.extractedText ? doc.extractedText.slice(0, 1200) : null,
    lastIndexedAt: doc.lastIndexedAt ? doc.lastIndexedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    departments: deptLinks.filter((l) => l.documentId === doc.id),
  }));
}

export async function uploadAndIndexDocument(params: {
  filename: string;
  buffer: Buffer;
  titleFa: string;
  collectionId: string | null;
  scope: 'global' | 'department' | 'restricted';
  classification?: DocumentClassification;
  validityStatus?: DocumentValidityStatus;
  isEnabled: boolean;
  departmentIds: string[];
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
  async?: boolean;
}) {
  const docId = `kbd_${randomUUID()}`;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  // Validate file signature, size, and extractability synchronously before storing
  const extracted = await validateAndExtractStructuredDocument({
    filename: params.filename,
    buffer: params.buffer,
    maxBytes: MAX_KB_DOCUMENT_BYTES,
  });

  const storageKey = `kb/${year}/${month}/${randomUUID()}.${extracted.extension}`;
  await getStorageDriver().put(storageKey, params.buffer);

  const classification = resolveDefaultClassification(
    params.scope,
    params.classification
  );
  const validityStatus: DocumentValidityStatus =
    params.validityStatus ?? 'current';

  await db.transaction(async (tx) => {
    await tx.insert(knowledgeDocuments).values({
      id: docId,
      collectionId: params.collectionId || null,
      titleFa: params.titleFa,
      originalFilename: params.filename,
      storageKey,
      mimeType: extracted.detectedMimeType,
      fileExtension: extracted.extension,
      byteSize: params.buffer.length,
      sha256: extracted.sha256,
      scope: params.scope,
      classification,
      status: 'processing',
      ingestionStage: 'queued',
      validityStatus,
      isEnabled: params.isEnabled,
      version: 1,
      extractedText: null,
      chunkCount: 0,
      uploadedBy: params.actorUserId,
    });

    await tx.insert(knowledgeDocumentVersions).values({
      id: `kdv_${randomUUID()}`,
      documentId: docId,
      version: 1,
      originalFilename: params.filename,
      storageKey,
      byteSize: params.buffer.length,
      sha256: extracted.sha256,
      status: 'processing',
      createdBy: params.actorUserId,
    });

    if (params.departmentIds.length > 0) {
      const validDepts = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(inArray(departments.id, params.departmentIds));
      for (const d of validDepts) {
        await tx.insert(knowledgeDocumentDepartments).values({
          documentId: docId,
          departmentId: d.id,
        });
      }
    }
  });

  const job = await enqueueDocumentIngestionJob({
    documentId: docId,
    jobType: 'ingest',
    targetVersion: 1,
    triggeredByUserId: params.actorUserId,
    payloadJson: { filename: params.filename, extension: extracted.extension },
  });

  if (params.async) {
    scheduleBackgroundIngestionWorker();
    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: 'kb.document.upload_queued',
      targetType: 'knowledge_document',
      targetId: docId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        extension: extracted.extension,
        byteSize: params.buffer.length,
        scope: params.scope,
        classification,
        jobId: job.id,
      },
    });

    return {
      id: docId,
      status: 'processing',
      ingestionStage: 'queued',
      chunkCount: 0,
      parentCount: 0,
      childCount: 0,
      embeddingModel: null,
      jobId: job.id,
    };
  }

  const jobResult = await runIngestionJobById(job.id);

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.uploaded_and_indexed',
    targetType: 'knowledge_document',
    targetId: docId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      extension: extracted.extension,
      byteSize: params.buffer.length,
      chunkCount: jobResult.chunkCount,
      parentCount: jobResult.parentCount,
      childCount: jobResult.childCount,
      embeddingModel: jobResult.embeddingModel,
      scope: params.scope,
      classification,
      jobId: job.id,
    },
  });

  return {
    id: docId,
    status: jobResult.status,
    ingestionStage: 'completed',
    chunkCount: jobResult.chunkCount,
    parentCount: jobResult.parentCount,
    childCount: jobResult.childCount,
    embeddingModel: jobResult.embeddingModel,
    jobId: job.id,
  };
}

export async function replaceKnowledgeDocumentFile(params: {
  documentId: string;
  filename: string;
  buffer: Buffer;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
  async?: boolean;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  const extracted = await validateAndExtractStructuredDocument({
    filename: params.filename,
    buffer: params.buffer,
    maxBytes: MAX_KB_DOCUMENT_BYTES,
  });

  const now = new Date();
  const storageKey = `kb/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extracted.extension}`;
  await getStorageDriver().put(storageKey, params.buffer);

  const nextVersion = doc.version + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeDocuments)
      .set({
        originalFilename: params.filename,
        storageKey,
        mimeType: extracted.detectedMimeType,
        fileExtension: extracted.extension,
        byteSize: params.buffer.length,
        sha256: extracted.sha256,
        version: nextVersion,
        status: 'processing',
        ingestionStage: 'queued',
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, params.documentId));

    await tx.insert(knowledgeDocumentVersions).values({
      id: `kdv_${randomUUID()}`,
      documentId: params.documentId,
      version: nextVersion,
      originalFilename: params.filename,
      storageKey,
      byteSize: params.buffer.length,
      sha256: extracted.sha256,
      status: 'processing',
      createdBy: params.actorUserId,
    });
  });

  const job = await enqueueDocumentIngestionJob({
    documentId: params.documentId,
    jobType: 'replace',
    targetVersion: nextVersion,
    triggeredByUserId: params.actorUserId,
    payloadJson: { filename: params.filename, version: nextVersion },
  });

  if (params.async) {
    scheduleBackgroundIngestionWorker();
    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: 'kb.document.replace_queued',
      targetType: 'knowledge_document',
      targetId: params.documentId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: { version: nextVersion, jobId: job.id },
    });
    return {
      id: params.documentId,
      version: nextVersion,
      chunkCount: 0,
      parentCount: 0,
      childCount: 0,
      status: 'processing',
      jobId: job.id,
    };
  }

  const jobResult = await runIngestionJobById(job.id);

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.replaced',
    targetType: 'knowledge_document',
    targetId: params.documentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      version: nextVersion,
      chunkCount: jobResult.chunkCount,
      parentCount: jobResult.parentCount,
      childCount: jobResult.childCount,
      jobId: job.id,
    },
  });

  return {
    id: params.documentId,
    version: nextVersion,
    chunkCount: jobResult.chunkCount,
    parentCount: jobResult.parentCount,
    childCount: jobResult.childCount,
    status: jobResult.status,
    jobId: job.id,
  };
}

export async function reprocessKnowledgeDocument(params: {
  documentId: string;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
  async?: boolean;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  await db
    .update(knowledgeDocuments)
    .set({
      status: 'processing',
      ingestionStage: 'queued',
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, doc.id));

  const job = await enqueueDocumentIngestionJob({
    documentId: doc.id,
    jobType: 'reprocess',
    targetVersion: doc.version,
    triggeredByUserId: params.actorUserId,
    payloadJson: { version: doc.version },
  });

  if (params.async) {
    scheduleBackgroundIngestionWorker();
    return {
      ok: true,
      queued: true,
      chunkCount: doc.chunkCount,
      parentCount: 0,
      childCount: 0,
      status: 'processing',
      jobId: job.id,
    };
  }

  const jobResult = await runIngestionJobById(job.id);

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.reprocessed',
    targetType: 'knowledge_document',
    targetId: doc.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      chunkCount: jobResult.chunkCount,
      parentCount: jobResult.parentCount,
      childCount: jobResult.childCount,
      jobId: job.id,
    },
  });

  return {
    ok: true,
    queued: false,
    chunkCount: jobResult.chunkCount,
    parentCount: jobResult.parentCount,
    childCount: jobResult.childCount,
    status: jobResult.status,
    jobId: job.id,
  };
}

export async function updateKnowledgeDocumentMetadata(params: {
  documentId: string;
  input: {
    titleFa?: string;
    collectionId?: string | null;
    scope?: 'global' | 'department' | 'restricted';
    classification?: DocumentClassification;
    validityStatus?: DocumentValidityStatus;
    supersededByDocId?: string | null;
    isEnabled?: boolean;
    departmentIds?: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  await db.transaction(async (tx) => {
    const updates: Partial<typeof knowledgeDocuments.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (params.input.titleFa !== undefined) updates.titleFa = params.input.titleFa;
    if (params.input.collectionId !== undefined)
      updates.collectionId = params.input.collectionId;
    if (params.input.scope !== undefined) updates.scope = params.input.scope;
    if (params.input.classification !== undefined)
      updates.classification = params.input.classification;
    if (params.input.validityStatus !== undefined)
      updates.validityStatus = params.input.validityStatus;
    if (params.input.supersededByDocId !== undefined)
      updates.supersededByDocId = params.input.supersededByDocId;

    if (params.input.isEnabled !== undefined) {
      updates.isEnabled = params.input.isEnabled;
      if (doc.status !== 'failed' && doc.status !== 'processing') {
        updates.status = params.input.isEnabled ? 'indexed' : 'disabled';
      }
    }

    await tx
      .update(knowledgeDocuments)
      .set(updates)
      .where(eq(knowledgeDocuments.id, params.documentId));

    const nextEnabled = params.input.isEnabled ?? doc.isEnabled;
    const nextScope = params.input.scope ?? doc.scope;
    const nextValidity = params.input.validityStatus ?? doc.validityStatus;
    const nextStatus = updates.status ?? doc.status;
    const nextClassification = params.input.classification ?? doc.classification;

    const shouldBeActive =
      nextStatus === 'indexed' &&
      nextEnabled &&
      nextScope !== 'restricted' &&
      nextValidity === 'current';

    await tx
      .update(knowledgeChunks)
      .set({
        isActive: shouldBeActive,
        ...(params.input.classification !== undefined
          ? { classification: nextClassification }
          : {}),
      })
      .where(eq(knowledgeChunks.documentId, params.documentId));

    await tx
      .update(knowledgeChunkVectors)
      .set({ isActive: shouldBeActive })
      .where(eq(knowledgeChunkVectors.documentId, params.documentId));

    if (params.input.departmentIds !== undefined) {
      await tx
        .delete(knowledgeDocumentDepartments)
        .where(eq(knowledgeDocumentDepartments.documentId, params.documentId));
      if (params.input.departmentIds.length > 0) {
        const validDepts = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(inArray(departments.id, params.input.departmentIds));
        for (const d of validDepts) {
          await tx.insert(knowledgeDocumentDepartments).values({
            documentId: params.documentId,
            departmentId: d.id,
          });
        }
      }
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.updated',
    targetType: 'knowledge_document',
    targetId: params.documentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      isEnabled: params.input.isEnabled,
      scope: params.input.scope,
      classification: params.input.classification,
      validityStatus: params.input.validityStatus,
    },
  });

  return true;
}

export async function deleteKnowledgeDocument(params: {
  documentId: string;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  const versions = await db
    .select({ storageKey: knowledgeDocumentVersions.storageKey })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, params.documentId));

  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, params.documentId));

  const keysToDelete = Array.from(
    new Set([doc.storageKey, ...versions.map((v) => v.storageKey)])
  );
  for (const key of keysToDelete) {
    try {
      await getStorageDriver().delete(key);
    } catch {
      // Ignore missing physical object during cleanup
    }
  }

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.deleted',
    targetType: 'knowledge_document',
    targetId: params.documentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { titleFa: doc.titleFa },
  });

  return true;
}

export async function listQaEntriesAdmin() {
  const [entries, deptLinks] = await Promise.all([
    db.select().from(knowledgeQaEntries).orderBy(desc(knowledgeQaEntries.updatedAt)),
    db
      .select({
        qaEntryId: knowledgeQaDepartments.qaEntryId,
        departmentId: departments.id,
        nameFa: departments.nameFa,
      })
      .from(knowledgeQaDepartments)
      .innerJoin(departments, eq(knowledgeQaDepartments.departmentId, departments.id)),
  ]);

  return entries.map((e) => ({
    id: e.id,
    collectionId: e.collectionId,
    question: e.question,
    alternativeQuestions: e.alternativeQuestions,
    officialAnswer: e.officialAnswer,
    category: e.category,
    keywords: e.keywords,
    scope: e.scope,
    status: e.status,
    embeddingModel: e.embeddingModel,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    departments: deptLinks.filter((d) => d.qaEntryId === e.id),
  }));
}

function buildQaSearchText(params: {
  question: string;
  alternativeQuestions: string[];
  officialAnswer: string;
  keywords: string[];
  category: string;
}): string {
  return normalizePersianForSearch(
    [
      params.question,
      ...params.alternativeQuestions,
      ...params.keywords,
      params.category,
      params.officialAnswer,
    ].join(' ')
  );
}

export async function createQaEntry(params: {
  input: {
    collectionId?: string | null;
    question: string;
    alternativeQuestions: string[];
    officialAnswer: string;
    category: string;
    keywords: string[];
    scope: 'global' | 'department' | 'restricted';
    status: 'draft' | 'published' | 'disabled';
    departmentIds: string[];
  };
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const id = `qa_${randomUUID()}`;
  const normalizedSearchText = buildQaSearchText(params.input);
  const lexicalText = buildLexicalIndexString(
    `${params.input.question}\n${params.input.officialAnswer}`,
    [
      ...params.input.alternativeQuestions,
      ...params.input.keywords,
      params.input.category,
    ]
  );

  const embedRes = await tryComputeEmbeddingWithModel(
    `${params.input.question}\n${params.input.alternativeQuestions.join('\n')}\n${params.input.officialAnswer}`
  );
  const isQaActive =
    params.input.status === 'published' && params.input.scope !== 'restricted';
  const vectorStore = getVectorStoreAdapter();

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(knowledgeQaEntries)
      .values({
        id,
        collectionId: params.input.collectionId || null,
        question: params.input.question,
        alternativeQuestions: params.input.alternativeQuestions,
        officialAnswer: params.input.officialAnswer,
        category: params.input.category,
        keywords: params.input.keywords,
        scope: params.input.scope,
        status: params.input.status,
        normalizedSearchText,
        embeddingJson: embedRes.embedding,
        embeddingModel: embedRes.embeddingModel,
        embeddingDimensions: embedRes.dimensions,
        searchTsv: sql`to_tsvector('simple', ${lexicalText})`,
        updatedBy: params.actorUserId,
      })
      .returning();

    if (
      embedRes.embedding &&
      embedRes.embeddingModel &&
      embedRes.dimensions
    ) {
      await vectorStore.upsertQaVector(tx, {
        qaEntryId: id,
        embeddingModel: embedRes.embeddingModel,
        dimensions: embedRes.dimensions,
        embedding: embedRes.embedding,
        isActive: isQaActive,
      });
    }

    if (params.input.departmentIds.length > 0) {
      const validDepts = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(inArray(departments.id, params.input.departmentIds));
      for (const d of validDepts) {
        await tx.insert(knowledgeQaDepartments).values({
          qaEntryId: id,
          departmentId: d.id,
        });
      }
    }

    return row;
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.qa.created',
    targetType: 'knowledge_qa_entry',
    targetId: created.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { status: created.status, scope: created.scope },
  });

  return created;
}

export async function updateQaEntry(params: {
  id: string;
  input: Partial<{
    collectionId: string | null;
    question: string;
    alternativeQuestions: string[];
    officialAnswer: string;
    category: string;
    keywords: string[];
    scope: 'global' | 'department' | 'restricted';
    status: 'draft' | 'published' | 'disabled';
    departmentIds: string[];
  }>;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.knowledgeQaEntries.findFirst({
    where: eq(knowledgeQaEntries.id, params.id),
  });
  if (!existing) return null;

  const mergedQuestion = params.input.question ?? existing.question;
  const mergedAlts = params.input.alternativeQuestions ?? existing.alternativeQuestions;
  const mergedAnswer = params.input.officialAnswer ?? existing.officialAnswer;
  const mergedKeywords = params.input.keywords ?? existing.keywords;
  const mergedCategory = params.input.category ?? existing.category;
  const mergedScope = params.input.scope ?? existing.scope;
  const mergedStatus = params.input.status ?? existing.status;

  const normalizedSearchText = buildQaSearchText({
    question: mergedQuestion,
    alternativeQuestions: mergedAlts,
    officialAnswer: mergedAnswer,
    keywords: mergedKeywords,
    category: mergedCategory,
  });
  const lexicalText = buildLexicalIndexString(
    `${mergedQuestion}\n${mergedAnswer}`,
    [...mergedAlts, ...mergedKeywords, mergedCategory]
  );

  const embedRes = await tryComputeEmbeddingWithModel(
    `${mergedQuestion}\n${mergedAlts.join('\n')}\n${mergedAnswer}`
  );
  const isQaActive = mergedStatus === 'published' && mergedScope !== 'restricted';
  const vectorStore = getVectorStoreAdapter();

  await db.transaction(async (tx) => {
    const { departmentIds, ...rest } = params.input;
    await tx
      .update(knowledgeQaEntries)
      .set({
        ...rest,
        normalizedSearchText,
        searchTsv: sql`to_tsvector('simple', ${lexicalText})`,
        ...(embedRes.embedding
          ? {
              embeddingJson: embedRes.embedding,
              embeddingModel: embedRes.embeddingModel,
              embeddingDimensions: embedRes.dimensions,
            }
          : {}),
        updatedBy: params.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeQaEntries.id, params.id));

    if (
      embedRes.embedding &&
      embedRes.embeddingModel &&
      embedRes.dimensions
    ) {
      await vectorStore.upsertQaVector(tx, {
        qaEntryId: params.id,
        embeddingModel: embedRes.embeddingModel,
        dimensions: embedRes.dimensions,
        embedding: embedRes.embedding,
        isActive: isQaActive,
      });
    } else {
      await tx
        .update(knowledgeQaVectors)
        .set({ isActive: isQaActive })
        .where(eq(knowledgeQaVectors.qaEntryId, params.id));
    }

    if (departmentIds !== undefined) {
      await tx
        .delete(knowledgeQaDepartments)
        .where(eq(knowledgeQaDepartments.qaEntryId, params.id));
      if (departmentIds.length > 0) {
        const validDepts = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(inArray(departments.id, departmentIds));
        for (const d of validDepts) {
          await tx.insert(knowledgeQaDepartments).values({
            qaEntryId: params.id,
            departmentId: d.id,
          });
        }
      }
    }
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.qa.updated',
    targetType: 'knowledge_qa_entry',
    targetId: params.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { status: params.input.status ?? existing.status },
  });

  return true;
}

export async function deleteQaEntry(params: {
  id: string;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const existing = await db.query.knowledgeQaEntries.findFirst({
    where: eq(knowledgeQaEntries.id, params.id),
  });
  if (!existing) return null;

  await db.transaction(async (tx) => {
    await getVectorStoreAdapter().deleteQaVector(tx, params.id);
    await tx.delete(knowledgeQaEntries).where(eq(knowledgeQaEntries.id, params.id));
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.qa.deleted',
    targetType: 'knowledge_qa_entry',
    targetId: params.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { question: existing.question.slice(0, 80) },
  });

  return true;
}

export async function getKnowledgeDocumentDownload(documentId: string) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: and(eq(knowledgeDocuments.id, documentId)),
  });
  if (!doc) return null;

  const buffer = await getStorageDriver().get(doc.storageKey);
  return {
    id: doc.id,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    byteSize: buffer.byteLength,
    buffer,
  };
}
