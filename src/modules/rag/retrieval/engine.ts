import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import {
  departmentKnowledgeCollections,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocumentDepartments,
  knowledgeDocuments,
  knowledgeQaDepartments,
  knowledgeQaEntries,
} from '@/src/db/schema.ts';
import type { AiProviderAdapter } from '../../ai/provider.ts';
import { detectKnowledgeConflict } from '../../knowledge/retrieval.ts';
import { sanitizeUntrustedExcerpt } from '../../knowledge/text.ts';
import type { LexicalSearchHit, VectorSearchHit } from '../stores/interfaces.ts';
import { getLexicalSearchAdapter } from '../stores/pg-lexical.ts';
import { getVectorStoreAdapter } from '../stores/pg-vector.ts';
import { resolveParentChildContextMap } from './parent-expander.ts';
import {
  transformQuery,
  type QueryTransformationTrace,
} from './query-transformer.ts';
import { createReranker, type RerankCandidate } from './reranker.ts';
import { fuseWithReciprocalRankFusion, type RrfFusionConfig } from './rrf.ts';
import {
  selectRetrievalStrategy,
  type RetrievalStrategy,
} from './strategy-selector.ts';

export interface AuthorizedKnowledgeScope {
  departmentId: string;
  authorizedDocuments: Array<{
    id: string;
    titleFa: string;
    scope: string;
    classification: string;
    version: number;
    validityStatus: string;
    embeddingModelUsed: string | null;
    updatedAt: Date;
  }>;
  authorizedQas: Array<{
    id: string;
    question: string;
    officialAnswer: string;
    scope: string;
    embeddingModel: string | null;
    updatedAt: Date;
  }>;
}

export interface RetrievedEvidenceItem {
  sourceType: 'qa' | 'document_chunk';
  sourceId: string;
  parentId: string;
  title: string;
  content: string; // Parent-expanded (when applicable) sanitized evidence text
  matchedSnippet: string; // Child chunk or Q&A concise excerpt
  score: number; // 0..100 final score (rerankScore if reranked, else normalizedRrfScore)
  rrfScore: number;
  rerankScore: number | null;
  lexicalRank: number | null;
  semanticRank: number | null;
  matchedBy: string[];
  scope: string;
  classification: string;
  documentVersion: number | null;
  validityStatus: string;
  pageNumber: number | null;
  sheetName: string | null;
  sectionTitle: string | null;
  headingPath: string | null;
  sourceRef: string | null;
  expandedFromParent: boolean;
  updatedAt: string;
}

export interface RetrievalTrace {
  strategy: RetrievalStrategy;
  strategyReasonFa: string;
  queryTransform: QueryTransformationTrace;
  authorizedDocCount: number;
  authorizedQaCount: number;
  lexicalDocHitCount: number;
  lexicalQaHitCount: number;
  semanticDocHitCount: number;
  semanticQaHitCount: number;
  fusedCandidateCount: number;
  rerankMethod: RerankCandidate['rerankMethod'];
  parentExpandedCount: number;
  latencyMs: number;
}

export interface AdvancedRetrievalOptions {
  departmentId: string;
  query: string;
  conversationHistory?: Array<{ senderRole: string; content: string }>;
  embeddingModel?: string | null;
  queryEmbedding?: number[] | null;
  embedder?: ((text: string) => Promise<number[] | null>) | null;
  adapter?: AiProviderAdapter | null;
  forcedStrategy?: RetrievalStrategy | null;
  rerankerMode?: 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder';
  httpRerankerConfig?: { endpointUrl: string; apiKey?: string | null; model?: string };
  enableLlmQueryTransform?: boolean;
  enableParentExpansion?: boolean;
  minConfidenceScore?: number;
  candidateLimit?: number;
  finalLimit?: number;
  rrfConfig?: RrfFusionConfig;
}

export interface AdvancedRetrievalResult {
  matches: RetrievedEvidenceItem[];
  topScore: number;
  conflictDetected: boolean;
  conflictSummaryFa: string | null;
  trace: RetrievalTrace;
}

/**
 * Resolves strictly authorized documents and Q&A entries for a department
 * BEFORE any vector search, lexical search, reranker, or LLM sees content.
 */
export async function resolveAuthorizedKnowledgeScope(
  departmentId: string
): Promise<AuthorizedKnowledgeScope> {
  const [deptCollectionRows, activeCollections, directDocRows, directQaRows] =
    await Promise.all([
      db
        .select({ collectionId: departmentKnowledgeCollections.collectionId })
        .from(departmentKnowledgeCollections)
        .where(eq(departmentKnowledgeCollections.departmentId, departmentId)),
      db
        .select({ id: knowledgeCollections.id, scope: knowledgeCollections.scope })
        .from(knowledgeCollections)
        .where(
          and(
            eq(knowledgeCollections.isActive, true),
            ne(knowledgeCollections.scope, 'restricted')
          )
        ),
      db
        .select({ documentId: knowledgeDocumentDepartments.documentId })
        .from(knowledgeDocumentDepartments)
        .where(eq(knowledgeDocumentDepartments.departmentId, departmentId)),
      db
        .select({ qaEntryId: knowledgeQaDepartments.qaEntryId })
        .from(knowledgeQaDepartments)
        .where(eq(knowledgeQaDepartments.departmentId, departmentId)),
    ]);

  const activeCollectionIds = new Set(activeCollections.map((c) => c.id));
  const authorizedCollectionIds = new Set(
    deptCollectionRows
      .map((r) => r.collectionId)
      .filter((cid) => activeCollectionIds.has(cid))
  );
  const directDocIds = new Set(directDocRows.map((r) => r.documentId));
  const directQaIds = new Set(directQaRows.map((r) => r.qaEntryId));

  const [indexedDocs, publishedQas] = await Promise.all([
    db
      .select({
        id: knowledgeDocuments.id,
        titleFa: knowledgeDocuments.titleFa,
        collectionId: knowledgeDocuments.collectionId,
        scope: knowledgeDocuments.scope,
        classification: knowledgeDocuments.classification,
        version: knowledgeDocuments.version,
        validityStatus: knowledgeDocuments.validityStatus,
        embeddingModelUsed: knowledgeDocuments.embeddingModelUsed,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.isEnabled, true),
          eq(knowledgeDocuments.status, 'indexed'),
          eq(knowledgeDocuments.validityStatus, 'current'),
          ne(knowledgeDocuments.scope, 'restricted')
        )
      ),
    db
      .select({
        id: knowledgeQaEntries.id,
        collectionId: knowledgeQaEntries.collectionId,
        question: knowledgeQaEntries.question,
        officialAnswer: knowledgeQaEntries.officialAnswer,
        scope: knowledgeQaEntries.scope,
        embeddingModel: knowledgeQaEntries.embeddingModel,
        updatedAt: knowledgeQaEntries.updatedAt,
      })
      .from(knowledgeQaEntries)
      .where(
        and(
          eq(knowledgeQaEntries.status, 'published'),
          ne(knowledgeQaEntries.scope, 'restricted')
        )
      ),
  ]);

  const authorizedDocuments = indexedDocs.filter((doc) => {
    if (doc.collectionId && !activeCollectionIds.has(doc.collectionId)) {
      return false;
    }
    if (doc.scope === 'global') return true;
    if (directDocIds.has(doc.id)) return true;
    if (doc.collectionId && authorizedCollectionIds.has(doc.collectionId)) return true;
    return false;
  });

  const authorizedQas = publishedQas.filter((qa) => {
    if (qa.collectionId && !activeCollectionIds.has(qa.collectionId)) {
      return false;
    }
    if (qa.scope === 'global') return true;
    if (directQaIds.has(qa.id)) return true;
    if (qa.collectionId && authorizedCollectionIds.has(qa.collectionId)) return true;
    return false;
  });

  return {
    departmentId,
    authorizedDocuments,
    authorizedQas,
  };
}

export async function runAdvancedRetrieval(
  options: AdvancedRetrievalOptions
): Promise<AdvancedRetrievalResult> {
  const startedAt = Date.now();
  const minConfidenceScore = options.minConfidenceScore ?? 25;
  const finalLimit = Math.max(1, Math.min(options.finalLimit ?? 6, 20));
  const rerankerMode = options.rerankerMode ?? 'cross_feature';

  // 1. Pre-LLM authorization filter
  const authScope = await resolveAuthorizedKnowledgeScope(options.departmentId);
  const authorizedDocIds = authScope.authorizedDocuments.map((d) => d.id);
  const authorizedQaIds = authScope.authorizedQas.map((q) => q.id);

  // Check if any authorized docs/QAs actually have compatible embeddings for the configured model
  const configuredModel = options.embeddingModel || null;
  const hasCompatibleVectors = Boolean(
    configuredModel &&
      (options.queryEmbedding || options.embedder || options.adapter) &&
      (authScope.authorizedDocuments.some(
        (d) => d.embeddingModelUsed === configuredModel
      ) ||
        authScope.authorizedQas.some(
          (q) => q.embeddingModel === configuredModel
        ))
  );

  // 2. Adaptive Strategy Selection
  const strategySel = selectRetrievalStrategy({
    query: options.query,
    conversationHistory: options.conversationHistory,
    hasEmbeddingModel: hasCompatibleVectors,
    forcedStrategy: options.forcedStrategy,
  });

  // 3. Query Transformation (normalization, contextualization, rewrite, expand, decompose)
  const queryTransform = await transformQuery({
    originalQuery: options.query,
    conversationHistory: options.conversationHistory,
    enableExpansion: strategySel.enableExpansion,
    enableDecomposition: strategySel.enableDecomposition,
    enableLlmRewrite: options.enableLlmQueryTransform,
    adapter: options.adapter,
    maxQueries: strategySel.strategy === 'decomposed' ? 5 : 4,
  });

  const candidateLimit = Math.max(
    finalLimit * 3,
    (options.candidateLimit ?? 16) * strategySel.candidateMultiplier
  );

  if (authorizedDocIds.length === 0 && authorizedQaIds.length === 0) {
    return {
      matches: [],
      topScore: 0,
      conflictDetected: false,
      conflictSummaryFa: null,
      trace: {
        strategy: strategySel.strategy,
        strategyReasonFa: strategySel.reasonFa,
        queryTransform,
        authorizedDocCount: 0,
        authorizedQaCount: 0,
        lexicalDocHitCount: 0,
        lexicalQaHitCount: 0,
        semanticDocHitCount: 0,
        semanticQaHitCount: 0,
        fusedCandidateCount: 0,
        rerankMethod: 'none',
        parentExpandedCount: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  const lexicalAdapter = getLexicalSearchAdapter();
  const vectorAdapter = getVectorStoreAdapter();

  const lexicalLists: LexicalSearchHit[][] = [];
  const semanticLists: Array<{
    sourceType: 'document_chunk' | 'qa';
    hits: VectorSearchHit[];
  }> = [];

  let lexicalDocHitCount = 0;
  let lexicalQaHitCount = 0;
  let semanticDocHitCount = 0;
  let semanticQaHitCount = 0;

  // 4A. Lexical retrieval (primary + decomposed/expanded sub-queries)
  if (strategySel.enableLexical) {
    const lexicalQueries =
      strategySel.strategy === 'decomposed' || strategySel.strategy === 'multi_query'
        ? queryTransform.generatedQueries.map((g) => g.query)
        : [queryTransform.contextualizedQuery];

    const extraQueries = queryTransform.generatedQueries.map((g) => g.query);

    for (const qText of lexicalQueries.slice(0, 3)) {
      const [docHits, qaHits] = await Promise.all([
        authorizedDocIds.length > 0
          ? lexicalAdapter.searchDocuments({
              authorizedDocumentIds: authorizedDocIds,
              query: qText,
              extraQueries,
              limit: candidateLimit,
            })
          : Promise.resolve([]),
        authorizedQaIds.length > 0
          ? lexicalAdapter.searchQaEntries({
              authorizedQaIds: authorizedQaIds,
              query: qText,
              extraQueries,
              limit: candidateLimit,
            })
          : Promise.resolve([]),
      ]);

      if (docHits.length > 0) {
        lexicalLists.push(docHits);
        lexicalDocHitCount += docHits.length;
      }
      if (qaHits.length > 0) {
        lexicalLists.push(qaHits);
        lexicalQaHitCount += qaHits.length;
      }
    }
  }

  // 4B. Semantic pgvector retrieval (strictly model & dimension isolated)
  if (strategySel.enableSemantic && configuredModel) {
    const queryVec =
      options.queryEmbedding ??
      (options.embedder
        ? await options.embedder(queryTransform.contextualizedQuery)
        : options.adapter
        ? await options.adapter.generateEmbedding(queryTransform.contextualizedQuery)
        : null);

    if (queryVec && queryVec.length > 0) {
      const [semDocs, semQas] = await Promise.all([
        authorizedDocIds.length > 0
          ? vectorAdapter.searchDocumentVectors({
              authorizedDocumentIds: authorizedDocIds,
              queryEmbedding: queryVec,
              embeddingModel: configuredModel,
              limit: candidateLimit,
            })
          : Promise.resolve([]),
        authorizedQaIds.length > 0
          ? vectorAdapter.searchQaVectors({
              authorizedQaIds: authorizedQaIds,
              queryEmbedding: queryVec,
              embeddingModel: configuredModel,
              limit: candidateLimit,
            })
          : Promise.resolve([]),
      ]);

      if (semDocs.length > 0) {
        semanticLists.push({ sourceType: 'document_chunk', hits: semDocs });
        semanticDocHitCount += semDocs.length;
      }
      if (semQas.length > 0) {
        semanticLists.push({ sourceType: 'qa', hits: semQas });
        semanticQaHitCount += semQas.length;
      }
    }
  }

  // 5. Reciprocal Rank Fusion (RRF)
  const fused = fuseWithReciprocalRankFusion({
    lexicalLists,
    semanticLists,
    config: {
      ...options.rrfConfig,
      limit: Math.max(finalLimit * 3, 18),
    },
  });

  if (fused.length === 0) {
    return {
      matches: [],
      topScore: 0,
      conflictDetected: false,
      conflictSummaryFa: null,
      trace: {
        strategy: strategySel.strategy,
        strategyReasonFa: strategySel.reasonFa,
        queryTransform,
        authorizedDocCount: authorizedDocIds.length,
        authorizedQaCount: authorizedQaIds.length,
        lexicalDocHitCount,
        lexicalQaHitCount,
        semanticDocHitCount,
        semanticQaHitCount,
        fusedCandidateCount: 0,
        rerankMethod: 'none',
        parentExpandedCount: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  // 6. Hydrate fused candidates with DB records & provenance
  const docMap = new Map(authScope.authorizedDocuments.map((d) => [d.id, d]));
  const qaMap = new Map(authScope.authorizedQas.map((q) => [q.id, q]));

  const chunkIds = fused
    .filter((f) => f.sourceType === 'document_chunk')
    .map((f) => f.id);

  const chunkRows =
    chunkIds.length > 0
      ? await db
          .select()
          .from(knowledgeChunks)
          .where(
            and(
              inArray(knowledgeChunks.id, chunkIds),
              eq(knowledgeChunks.isActive, true)
            )
          )
      : [];
  const chunkMap = new Map(chunkRows.map((c) => [c.id, c]));

  const rerankInput: RerankCandidate[] = [];
  const fusedByKey = new Map(fused.map((f) => [f.key, f]));

  for (const item of fused) {
    if (item.sourceType === 'qa') {
      const qa = qaMap.get(item.id);
      if (!qa) continue;
      rerankInput.push({
        key: item.key,
        sourceType: 'qa',
        sourceId: qa.id,
        parentId: qa.id,
        title: qa.question,
        headingPath: null,
        sectionTitle: null,
        content: sanitizeUntrustedExcerpt(
          `پرسش رسمی: ${qa.question}\nپاسخ رسمی: ${qa.officialAnswer}`
        ),
        chunkType: 'qa',
        initialScore: item.normalizedRrfScore,
        rerankScore: item.normalizedRrfScore,
        rerankMethod: 'none',
      });
    } else {
      const ch = chunkMap.get(item.id);
      const doc = ch ? docMap.get(ch.documentId) : undefined;
      if (!ch || !doc) continue;
      rerankInput.push({
        key: item.key,
        sourceType: 'document_chunk',
        sourceId: ch.id,
        parentId: doc.id,
        title: doc.titleFa,
        headingPath: ch.headingPath,
        sectionTitle: ch.sectionTitle,
        content: sanitizeUntrustedExcerpt(ch.content),
        chunkType: ch.chunkType,
        initialScore: item.normalizedRrfScore,
        rerankScore: item.normalizedRrfScore,
        rerankMethod: 'none',
      });
    }
  }

  // 7. Replaceable Reranking Layer
  const reranker = createReranker({
    mode: rerankerMode,
    adapter: options.adapter,
    httpConfig: options.httpRerankerConfig,
  });

  const reranked = reranker
    ? await reranker.rerank({
        query: queryTransform.contextualizedQuery,
        candidates: rerankInput,
        limit: finalLimit,
      })
    : rerankInput.slice(0, finalLimit);

  // 8. Parent-Child Context Expansion
  const enableParentExpansion = options.enableParentExpansion !== false;
  const selectedChildRefs = reranked
    .filter((r) => r.sourceType === 'document_chunk')
    .map((r) => {
      const ch = chunkMap.get(r.sourceId)!;
      return {
        chunkId: ch.id,
        documentId: ch.documentId,
        parentChunkId: ch.parentChunkId,
        chunkIndex: ch.chunkIndex,
        content: r.content,
      };
    });

  const parentContextMap = enableParentExpansion
    ? await resolveParentChildContextMap(selectedChildRefs)
    : new Map();

  let parentExpandedCount = 0;
  const finalMatches: RetrievedEvidenceItem[] = [];

  for (const r of reranked) {
    const fusedMeta = fusedByKey.get(r.key)!;
    if (r.sourceType === 'qa') {
      const qa = qaMap.get(r.sourceId)!;
      finalMatches.push({
        sourceType: 'qa',
        sourceId: qa.id,
        parentId: qa.id,
        title: qa.question,
        content: r.content,
        matchedSnippet: r.content,
        score: r.rerankScore,
        rrfScore: fusedMeta.rrfScore,
        rerankScore: r.rerankMethod === 'none' ? null : r.rerankScore,
        lexicalRank: fusedMeta.lexicalRank,
        semanticRank: fusedMeta.semanticRank,
        matchedBy: fusedMeta.matchedBy,
        scope: qa.scope,
        classification: qa.scope === 'global' ? 'public_org' : 'department',
        documentVersion: null,
        validityStatus: 'current',
        pageNumber: null,
        sheetName: null,
        sectionTitle: null,
        headingPath: null,
        sourceRef: `qa:${qa.id}`,
        expandedFromParent: false,
        updatedAt: qa.updatedAt.toISOString(),
      });
    } else {
      const ch = chunkMap.get(r.sourceId)!;
      const doc = docMap.get(ch.documentId)!;
      const parentCtx = parentContextMap.get(ch.id);
      const expandedFromParent = Boolean(parentCtx?.expandedFromParent);
      if (expandedFromParent) parentExpandedCount++;

      finalMatches.push({
        sourceType: 'document_chunk',
        sourceId: ch.id,
        parentId: doc.id,
        title: doc.titleFa,
        content: sanitizeUntrustedExcerpt(
          parentCtx?.expandedContent || ch.content
        ),
        matchedSnippet: r.content,
        score: r.rerankScore,
        rrfScore: fusedMeta.rrfScore,
        rerankScore: r.rerankMethod === 'none' ? null : r.rerankScore,
        lexicalRank: fusedMeta.lexicalRank,
        semanticRank: fusedMeta.semanticRank,
        matchedBy: fusedMeta.matchedBy,
        scope: doc.scope,
        classification: doc.classification,
        documentVersion: ch.documentVersion ?? doc.version,
        validityStatus: doc.validityStatus,
        pageNumber: ch.pageNumber ?? parentCtx?.pageNumber ?? null,
        sheetName: ch.sheetName ?? parentCtx?.sheetName ?? null,
        sectionTitle: ch.sectionTitle ?? parentCtx?.sectionTitle ?? null,
        headingPath: ch.headingPath ?? parentCtx?.headingPath ?? null,
        sourceRef: ch.sourceRef,
        expandedFromParent,
        updatedAt: doc.updatedAt.toISOString(),
      });
    }
  }

  const topScore = finalMatches[0]?.score ?? 0;
  const conflict = detectKnowledgeConflict(
    queryTransform.contextualizedQuery,
    finalMatches.map((m) => ({
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      parentId: m.parentId,
      title: m.title,
      content: m.matchedSnippet,
      score: m.score,
      scope: m.scope,
      updatedAt: m.updatedAt,
    })),
    minConfidenceScore
  );

  return {
    matches: finalMatches,
    topScore,
    conflictDetected: conflict.conflictDetected,
    conflictSummaryFa: conflict.conflictSummaryFa,
    trace: {
      strategy: strategySel.strategy,
      strategyReasonFa: strategySel.reasonFa,
      queryTransform,
      authorizedDocCount: authorizedDocIds.length,
      authorizedQaCount: authorizedQaIds.length,
      lexicalDocHitCount,
      lexicalQaHitCount,
      semanticDocHitCount,
      semanticQaHitCount,
      fusedCandidateCount: fused.length,
      rerankMethod: reranked[0]?.rerankMethod ?? 'none',
      parentExpandedCount,
      latencyMs: Date.now() - startedAt,
    },
  };
}
