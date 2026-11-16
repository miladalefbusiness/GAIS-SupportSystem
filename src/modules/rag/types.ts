export type SupportedDocumentFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'xlsx';

export type DocumentClassification =
  | 'public_org'
  | 'department'
  | 'internal_restricted';

export type DocumentValidityStatus = 'current' | 'superseded' | 'expired';

export type IngestionJobType =
  | 'ingest'
  | 'replace'
  | 'reprocess'
  | 'reindex_embeddings';

export type IngestionJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IngestionStage =
  | 'queued'
  | 'validating'
  | 'extracting'
  | 'normalizing'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'completed'
  | 'failed';

export type StructuredBlockType = 'heading' | 'paragraph' | 'table' | 'list';

export interface StructuredBlock {
  type: StructuredBlockType;
  text: string;
  level?: number; // 1..6 for headings
  headingPath: string[];
  sectionTitle: string | null;
  pageNumber: number | null;
  sheetName: string | null;
}

export interface ExtractedStructuredDocument {
  extension: SupportedDocumentFormat;
  detectedMimeType: string;
  sha256: string;
  extractedText: string;
  blocks: StructuredBlock[];
  pageCount: number | null;
  sheetNames: string[];
}

export interface ChunkProvenanceMetadata {
  documentId: string;
  documentVersion: number;
  collectionId: string | null;
  departmentIds: string[];
  pageNumber: number | null;
  sheetName: string | null;
  sectionTitle: string | null;
  headingPath: string | null;
  chunkSequence: number;
  sourceRef: string;
  classification: DocumentClassification;
  chunkLevel: 'parent' | 'child';
  chunkType: 'text' | 'table' | 'list' | 'section';
  indexedAt: string;
}

export interface ChunkDraft {
  id: string;
  parentChunkId: string | null;
  chunkLevel: 'parent' | 'child';
  chunkIndex: number;
  chunkType: 'text' | 'table' | 'list' | 'section';
  content: string;
  normalizedContent: string;
  tokenEstimate: number;
  headingPath: string | null;
  sectionTitle: string | null;
  pageNumber: number | null;
  sheetName: string | null;
  sourceRef: string;
  classification: DocumentClassification;
  provenance: ChunkProvenanceMetadata;
}
