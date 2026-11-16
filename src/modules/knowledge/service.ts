import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { recordAuditLog } from '@/src/core/audit/audit.ts';
import { getStorageDriver } from '@/src/core/storage/local-storage.ts';
import { db } from '@/src/db/index.ts';
import {
  departmentKnowledgeCollections,
  departments,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocumentDepartments,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgeQaDepartments,
  knowledgeQaEntries,
} from '@/src/db/schema.ts';
import { createAiProviderAdapter } from '../ai/provider.ts';
import { getInternalAiProviderRuntimeConfig } from '../ai/settings.ts';
import { validateAndExtractDocument } from './extractor.ts';
import { chunkDocumentText, normalizePersianText } from './text.ts';

const MAX_KB_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

async function tryComputeEmbedding(text: string): Promise<number[] | null> {
  try {
    const config = await getInternalAiProviderRuntimeConfig();
    if (!config.embeddingModel) return null;
    const adapter = createAiProviderAdapter(config);
    return await adapter.generateEmbedding(text.slice(0, 6000));
  } catch {
    return null;
  }
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
    status: doc.status,
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

async function indexDocumentTextChunks(params: {
  documentId: string;
  extractedText: string;
  titleFa: string;
}) {
  const chunks = chunkDocumentText(params.extractedText);
  if (chunks.length === 0) {
    throw new Error('EXTRACTED_TEXT_EMPTY');
  }

  const chunkRecords = await Promise.all(
    chunks.map(async (content, index) => {
      const normalizedContent = normalizePersianText(content);
      const embeddingJson = await tryComputeEmbedding(content);
      return {
        id: `kbc_${randomUUID()}`,
        documentId: params.documentId,
        chunkIndex: index,
        content,
        normalizedContent,
        tokenEstimate: Math.ceil(content.length / 4),
        metadataJson: { titleFa: params.titleFa, chunkIndex: index },
        embeddingJson,
      };
    })
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, params.documentId));
    await tx.insert(knowledgeChunks).values(chunkRecords);
  });

  return chunkRecords.length;
}

export async function uploadAndIndexDocument(params: {
  filename: string;
  buffer: Buffer;
  titleFa: string;
  collectionId: string | null;
  scope: 'global' | 'department' | 'restricted';
  isEnabled: boolean;
  departmentIds: string[];
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const docId = `kbd_${randomUUID()}`;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeExt = params.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const storageKey = `kb/${year}/${month}/${randomUUID()}.${safeExt}`;

  // First validate & extract before saving metadata, OR store file & record failed status if extraction fails
  let extracted;
  try {
    extracted = await validateAndExtractDocument({
      filename: params.filename,
      buffer: params.buffer,
      maxBytes: MAX_KB_DOCUMENT_BYTES,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'EXTRACTION_FAILED';
    throw new Error(code);
  }

  await getStorageDriver().put(storageKey, params.buffer);

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
      status: 'processing',
      isEnabled: params.isEnabled,
      version: 1,
      extractedText: extracted.extractedText,
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

  try {
    const chunkCount = await indexDocumentTextChunks({
      documentId: docId,
      extractedText: extracted.extractedText,
      titleFa: params.titleFa,
    });

    const finalStatus = params.isEnabled ? 'indexed' : 'disabled';
    await db
      .update(knowledgeDocuments)
      .set({
        status: finalStatus,
        chunkCount,
        errorMessage: null,
        lastIndexedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, docId));

    await db
      .update(knowledgeDocumentVersions)
      .set({ status: finalStatus })
      .where(eq(knowledgeDocumentVersions.documentId, docId));

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
        chunkCount,
        scope: params.scope,
      },
    });

    return { id: docId, status: finalStatus, chunkCount };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : 'خطا در قطعه‌بندی و نمایه‌سازی سند';
    await db
      .update(knowledgeDocuments)
      .set({
        status: 'failed',
        chunkCount: 0,
        errorMessage: errMsg,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, docId));
    throw err;
  }
}

export async function replaceKnowledgeDocumentFile(params: {
  documentId: string;
  filename: string;
  buffer: Buffer;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  const extracted = await validateAndExtractDocument({
    filename: params.filename,
    buffer: params.buffer,
    maxBytes: MAX_KB_DOCUMENT_BYTES,
  });

  const now = new Date();
  const storageKey = `kb/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extracted.extension}`;
  await getStorageDriver().put(storageKey, params.buffer);

  const nextVersion = doc.version + 1;

  await db
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
      extractedText: extracted.extractedText,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, params.documentId));

  const chunkCount = await indexDocumentTextChunks({
    documentId: params.documentId,
    extractedText: extracted.extractedText,
    titleFa: doc.titleFa,
  });

  const finalStatus = doc.isEnabled ? 'indexed' : 'disabled';
  await db
    .update(knowledgeDocuments)
    .set({
      status: finalStatus,
      chunkCount,
      lastIndexedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, params.documentId));

  await db.insert(knowledgeDocumentVersions).values({
    id: `kdv_${randomUUID()}`,
    documentId: params.documentId,
    version: nextVersion,
    originalFilename: params.filename,
    storageKey,
    byteSize: params.buffer.length,
    sha256: extracted.sha256,
    status: finalStatus,
    createdBy: params.actorUserId,
  });

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kb.document.replaced',
    targetType: 'knowledge_document',
    targetId: params.documentId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: { version: nextVersion, chunkCount },
  });

  return { id: params.documentId, version: nextVersion, chunkCount, status: finalStatus };
}

export async function reprocessKnowledgeDocument(params: {
  documentId: string;
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const doc = await db.query.knowledgeDocuments.findFirst({
    where: eq(knowledgeDocuments.id, params.documentId),
  });
  if (!doc) return null;

  try {
    const fileBuf = await getStorageDriver().get(doc.storageKey);
    const extracted = await validateAndExtractDocument({
      filename: doc.originalFilename,
      buffer: fileBuf,
      maxBytes: MAX_KB_DOCUMENT_BYTES,
    });

    const chunkCount = await indexDocumentTextChunks({
      documentId: doc.id,
      extractedText: extracted.extractedText,
      titleFa: doc.titleFa,
    });

    const finalStatus = doc.isEnabled ? 'indexed' : 'disabled';
    await db
      .update(knowledgeDocuments)
      .set({
        extractedText: extracted.extractedText,
        chunkCount,
        status: finalStatus,
        errorMessage: null,
        lastIndexedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, doc.id));

    await recordAuditLog({
      actorUserId: params.actorUserId,
      action: 'kb.document.reprocessed',
      targetType: 'knowledge_document',
      targetId: doc.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: { chunkCount },
    });

    return { ok: true, chunkCount, status: finalStatus };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'REPROCESS_FAILED';
    await db
      .update(knowledgeDocuments)
      .set({
        status: 'failed',
        errorMessage: msg,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, doc.id));
    throw err;
  }
}

export async function updateKnowledgeDocumentMetadata(params: {
  documentId: string;
  input: {
    titleFa?: string;
    collectionId?: string | null;
    scope?: 'global' | 'department' | 'restricted';
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
    if (params.input.isEnabled !== undefined) {
      updates.isEnabled = params.input.isEnabled;
      if (doc.status !== 'failed') {
        updates.status = params.input.isEnabled ? 'indexed' : 'disabled';
      }
    }

    await tx
      .update(knowledgeDocuments)
      .set(updates)
      .where(eq(knowledgeDocuments.id, params.documentId));

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
  return normalizePersianText(
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
  const embeddingJson = await tryComputeEmbedding(
    `${params.input.question}\n${params.input.alternativeQuestions.join('\n')}\n${params.input.officialAnswer}`
  );

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
        embeddingJson,
        updatedBy: params.actorUserId,
      })
      .returning();

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

  const normalizedSearchText = buildQaSearchText({
    question: mergedQuestion,
    alternativeQuestions: mergedAlts,
    officialAnswer: mergedAnswer,
    keywords: mergedKeywords,
    category: mergedCategory,
  });

  const embeddingJson = await tryComputeEmbedding(
    `${mergedQuestion}\n${mergedAlts.join('\n')}\n${mergedAnswer}`
  );

  await db.transaction(async (tx) => {
    const { departmentIds, ...rest } = params.input;
    await tx
      .update(knowledgeQaEntries)
      .set({
        ...rest,
        normalizedSearchText,
        ...(embeddingJson ? { embeddingJson } : {}),
        updatedBy: params.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeQaEntries.id, params.id));

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

  await db.delete(knowledgeQaEntries).where(eq(knowledgeQaEntries.id, params.id));

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
    where: eq(knowledgeDocuments.id, documentId),
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

