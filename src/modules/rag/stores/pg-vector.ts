import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import {
  knowledgeChunkVectors,
  knowledgeDocuments,
  knowledgeQaEntries,
  knowledgeQaVectors,
} from '@/src/db/schema.ts';
import type {
  DbExecutor,
  VectorChunkRecord,
  VectorQaRecord,
  VectorSearchHit,
  VectorStoreAdapter,
} from './interfaces.ts';

function toPgVectorLiteral(vec: number[]): string {
  // Validate finite numbers strictly before building pgvector literal
  const clean = vec.map((n) => (Number.isFinite(n) ? Number(n) : 0));
  return `[${clean.join(',')}]`;
}

export class PgVectorStoreAdapter implements VectorStoreAdapter {
  readonly backendName = 'pgvector';

  async upsertDocumentVectors(
    executor: DbExecutor,
    records: VectorChunkRecord[]
  ): Promise<void> {
    if (records.length === 0) return;

    for (const rec of records) {
      if (!rec.embedding.length) continue;
      await executor
        .insert(knowledgeChunkVectors)
        .values({
          chunkId: rec.chunkId,
          documentId: rec.documentId,
          documentVersion: rec.documentVersion,
          embeddingModel: rec.embeddingModel,
          dimensions: rec.dimensions,
          embedding: rec.embedding,
          isActive: rec.isActive ?? true,
        })
        .onConflictDoUpdate({
          target: knowledgeChunkVectors.chunkId,
          set: {
            documentVersion: rec.documentVersion,
            embeddingModel: rec.embeddingModel,
            dimensions: rec.dimensions,
            embedding: rec.embedding,
            isActive: rec.isActive ?? true,
          },
        });
    }
  }

  async deactivateDocumentVectors(
    executor: DbExecutor,
    documentId: string
  ): Promise<void> {
    await executor
      .update(knowledgeChunkVectors)
      .set({ isActive: false })
      .where(eq(knowledgeChunkVectors.documentId, documentId));
  }

  async deleteDocumentVectors(
    executor: DbExecutor,
    documentId: string
  ): Promise<void> {
    await executor
      .delete(knowledgeChunkVectors)
      .where(eq(knowledgeChunkVectors.documentId, documentId));
  }

  async upsertQaVector(
    executor: DbExecutor,
    record: VectorQaRecord
  ): Promise<void> {
    if (!record.embedding.length) return;
    await executor
      .insert(knowledgeQaVectors)
      .values({
        qaEntryId: record.qaEntryId,
        embeddingModel: record.embeddingModel,
        dimensions: record.dimensions,
        embedding: record.embedding,
        isActive: record.isActive ?? true,
      })
      .onConflictDoUpdate({
        target: knowledgeQaVectors.qaEntryId,
        set: {
          embeddingModel: record.embeddingModel,
          dimensions: record.dimensions,
          embedding: record.embedding,
          isActive: record.isActive ?? true,
        },
      });
  }

  async deleteQaVector(
    executor: DbExecutor,
    qaEntryId: string
  ): Promise<void> {
    await executor
      .delete(knowledgeQaVectors)
      .where(eq(knowledgeQaVectors.qaEntryId, qaEntryId));
  }

  /**
   * Executes pgvector cosine distance search strictly restricted to:
   * 1. Pre-authorized document IDs
   * 2. Active chunk & vector flags
   * 3. Exact matching embeddingModel AND dimensions (prevents silent cross-model vector corruption)
   */
  async searchDocumentVectors(params: {
    authorizedDocumentIds: string[];
    queryEmbedding: number[];
    embeddingModel: string;
    limit: number;
  }): Promise<VectorSearchHit[]> {
    if (
      params.authorizedDocumentIds.length === 0 ||
      params.queryEmbedding.length === 0 ||
      !params.embeddingModel
    ) {
      return [];
    }

    const dim = params.queryEmbedding.length;
    const vecLiteral = toPgVectorLiteral(params.queryEmbedding);
    const docIdArray = sql.join(
      params.authorizedDocumentIds.map((id) => sql`${id}`),
      sql`, `
    );

    const res = await db.execute<{
      chunk_id: string;
      document_id: string;
      embedding_model: string;
      cosine_distance: number;
    }>(sql`
      SELECT
        v.chunk_id,
        v.document_id,
        v.embedding_model,
        (v.embedding <=> ${vecLiteral}::vector) AS cosine_distance
      FROM knowledge_chunk_vectors v
      INNER JOIN knowledge_chunks c ON c.id = v.chunk_id
      WHERE v.document_id IN (${docIdArray})
        AND v.is_active = true
        AND c.is_active = true
        AND c.chunk_level = 'child'
        AND v.embedding_model = ${params.embeddingModel}
        AND v.dimensions = ${dim}
      ORDER BY (v.embedding <=> ${vecLiteral}::vector) ASC
      LIMIT ${Math.max(1, Math.min(params.limit, 100))}
    `);

    return res.rows.map((row, idx) => {
      const dist = Number(row.cosine_distance);
      const similarity = Number.isFinite(dist)
        ? Math.max(0, Math.min(1, 1 - dist))
        : 0;
      return {
        id: row.chunk_id,
        parentId: row.document_id,
        similarity,
        rank: idx + 1,
        embeddingModel: row.embedding_model,
      };
    });
  }

  async searchQaVectors(params: {
    authorizedQaIds: string[];
    queryEmbedding: number[];
    embeddingModel: string;
    limit: number;
  }): Promise<VectorSearchHit[]> {
    if (
      params.authorizedQaIds.length === 0 ||
      params.queryEmbedding.length === 0 ||
      !params.embeddingModel
    ) {
      return [];
    }

    const dim = params.queryEmbedding.length;
    const vecLiteral = toPgVectorLiteral(params.queryEmbedding);
    const qaIdArray = sql.join(
      params.authorizedQaIds.map((id) => sql`${id}`),
      sql`, `
    );

    const res = await db.execute<{
      qa_entry_id: string;
      embedding_model: string;
      cosine_distance: number;
    }>(sql`
      SELECT
        v.qa_entry_id,
        v.embedding_model,
        (v.embedding <=> ${vecLiteral}::vector) AS cosine_distance
      FROM knowledge_qa_vectors v
      WHERE v.qa_entry_id IN (${qaIdArray})
        AND v.is_active = true
        AND v.embedding_model = ${params.embeddingModel}
        AND v.dimensions = ${dim}
      ORDER BY (v.embedding <=> ${vecLiteral}::vector) ASC
      LIMIT ${Math.max(1, Math.min(params.limit, 100))}
    `);

    return res.rows.map((row, idx) => {
      const dist = Number(row.cosine_distance);
      const similarity = Number.isFinite(dist)
        ? Math.max(0, Math.min(1, 1 - dist))
        : 0;
      return {
        id: row.qa_entry_id,
        parentId: row.qa_entry_id,
        similarity,
        rank: idx + 1,
        embeddingModel: row.embedding_model,
      };
    });
  }
}

let cachedVectorStore: VectorStoreAdapter | null = null;

export function getVectorStoreAdapter(): VectorStoreAdapter {
  if (!cachedVectorStore) {
    cachedVectorStore = new PgVectorStoreAdapter();
  }
  return cachedVectorStore;
}

/**
 * Checks whether indexed documents or Q&As use a different embedding model than
 * the currently configured one so the engine safely avoids mixed-vector search and
 * admins can see what needs re-embedding.
 */
export async function getEmbeddingIndexHealth(activeEmbeddingModel: string | null) {
  const [indexedDocs, publishedQas] = await Promise.all([
    db
      .select({
        id: knowledgeDocuments.id,
        titleFa: knowledgeDocuments.titleFa,
        embeddingModelUsed: knowledgeDocuments.embeddingModelUsed,
        embeddingDimensions: knowledgeDocuments.embeddingDimensions,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.status, 'indexed'),
          eq(knowledgeDocuments.isEnabled, true)
        )
      ),
    db
      .select({
        id: knowledgeQaEntries.id,
        embeddingModel: knowledgeQaEntries.embeddingModel,
      })
      .from(knowledgeQaEntries)
      .where(ne(knowledgeQaEntries.status, 'disabled')),
  ]);

  const mismatchedDocs = activeEmbeddingModel
    ? indexedDocs.filter(
        (d) =>
          d.embeddingModelUsed !== null &&
          d.embeddingModelUsed !== activeEmbeddingModel
      )
    : [];

  const unembeddedDocs = activeEmbeddingModel
    ? indexedDocs.filter((d) => d.embeddingModelUsed === null)
    : [];

  const mismatchedQas = activeEmbeddingModel
    ? publishedQas.filter(
        (q) => q.embeddingModel !== null && q.embeddingModel !== activeEmbeddingModel
      )
    : [];

  return {
    activeEmbeddingModel,
    totalIndexedDocs: indexedDocs.length,
    totalQas: publishedQas.length,
    mismatchedDocsCount: mismatchedDocs.length,
    unembeddedDocsCount: unembeddedDocs.length,
    mismatchedQasCount: mismatchedQas.length,
    mismatchedDocumentIds: mismatchedDocs.map((d) => d.id),
    needsReindex:
      Boolean(activeEmbeddingModel) &&
      (mismatchedDocs.length > 0 ||
        unembeddedDocs.length > 0 ||
        mismatchedQas.length > 0),
  };
}

export async function syncDocumentChunksActiveState(
  documentIds: string[],
  isActive: boolean
): Promise<void> {
  if (documentIds.length === 0) return;
  await db
    .update(knowledgeChunkVectors)
    .set({ isActive })
    .where(inArray(knowledgeChunkVectors.documentId, documentIds));
}
