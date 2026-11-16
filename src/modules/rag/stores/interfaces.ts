import type { db } from '@/src/db/index.ts';

export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface VectorChunkRecord {
  chunkId: string;
  documentId: string;
  documentVersion: number;
  embeddingModel: string;
  dimensions: number;
  embedding: number[];
  isActive?: boolean;
}

export interface VectorQaRecord {
  qaEntryId: string;
  embeddingModel: string;
  dimensions: number;
  embedding: number[];
  isActive?: boolean;
}

export interface VectorSearchHit {
  id: string; // chunkId or qaEntryId
  parentId: string; // documentId or qaEntryId
  similarity: number; // 0..1 cosine similarity
  rank: number;
  embeddingModel: string;
}

export interface VectorStoreAdapter {
  readonly backendName: string;

  upsertDocumentVectors(
    executor: DbExecutor,
    records: VectorChunkRecord[]
  ): Promise<void>;

  deactivateDocumentVectors(
    executor: DbExecutor,
    documentId: string
  ): Promise<void>;

  deleteDocumentVectors(
    executor: DbExecutor,
    documentId: string
  ): Promise<void>;

  upsertQaVector(executor: DbExecutor, record: VectorQaRecord): Promise<void>;

  deleteQaVector(executor: DbExecutor, qaEntryId: string): Promise<void>;

  searchDocumentVectors(params: {
    authorizedDocumentIds: string[];
    queryEmbedding: number[];
    embeddingModel: string;
    limit: number;
  }): Promise<VectorSearchHit[]>;

  searchQaVectors(params: {
    authorizedQaIds: string[];
    queryEmbedding: number[];
    embeddingModel: string;
    limit: number;
  }): Promise<VectorSearchHit[]>;
}

export interface LexicalSearchHit {
  sourceType: 'document_chunk' | 'qa';
  id: string;
  parentId: string;
  score: number; // 0..1 normalized lexical score
  rank: number;
  matchedBy: 'fts' | 'trgm' | 'exact_identifier' | 'fallback';
}

export interface LexicalSearchAdapter {
  readonly backendName: string;

  searchDocuments(params: {
    authorizedDocumentIds: string[];
    query: string;
    extraQueries?: string[];
    limit: number;
  }): Promise<LexicalSearchHit[]>;

  searchQaEntries(params: {
    authorizedQaIds: string[];
    query: string;
    extraQueries?: string[];
    limit: number;
  }): Promise<LexicalSearchHit[]>;
}
