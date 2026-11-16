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
import {
  normalizePersianText,
  sanitizeUntrustedExcerpt,
  scoreTextRelevance,
  tokenizeSearchTerms,
} from './text.ts';

export interface RetrievedKnowledgeMatch {
  sourceType: 'qa' | 'document_chunk';
  sourceId: string;
  parentId: string;
  title: string;
  content: string;
  score: number;
  scope: string;
  updatedAt: string;
}

export interface RetrievalPipelineResult {
  matches: RetrievedKnowledgeMatch[];
  topScore: number;
  conflictDetected: boolean;
  conflictSummaryFa: string | null;
}

function extractNormalizedNumbers(text: string): string[] {
  const norm = normalizePersianText(text);
  const nums = norm.match(/\d+(?:[.,/]\d+)?/g) || [];
  return Array.from(new Set(nums));
}

export function detectKnowledgeConflict(
  query: string,
  matches: RetrievedKnowledgeMatch[],
  minScore: number
): { conflictDetected: boolean; conflictSummaryFa: string | null } {
  const strongMatches = matches.filter((m) => m.score >= minScore);
  if (strongMatches.length < 2) {
    return { conflictDetected: false, conflictSummaryFa: null };
  }

  const queryTerms = tokenizeSearchTerms(query);
  if (queryTerms.length === 0) {
    return { conflictDetected: false, conflictSummaryFa: null };
  }

  const primary = strongMatches[0];
  for (let i = 1; i < Math.min(strongMatches.length, 4); i++) {
    const other = strongMatches[i];
    if (other.parentId === primary.parentId) continue;
    if (primary.score - other.score > 25) continue;

    // Check topic overlap
    const normA = normalizePersianText(`${primary.title} ${primary.content}`);
    const normB = normalizePersianText(`${other.title} ${other.content}`);
    const overlapCount = queryTerms.filter(
      (t) => normA.includes(t) && normB.includes(t)
    ).length;

    if (overlapCount < Math.min(2, queryTerms.length)) continue;

    // Compare distinct numeric figures (fees, days, deadlines, percentages, years)
    const numsA = extractNormalizedNumbers(primary.content);
    const numsB = extractNormalizedNumbers(other.content);
    if (numsA.length > 0 && numsB.length > 0) {
      const setA = new Set(numsA);
      const setB = new Set(numsB);
      const hasShared = numsA.some((n) => setB.has(n));
      const differs =
        numsA.some((n) => !setB.has(n)) || numsB.some((n) => !setA.has(n));

      if (!hasShared && differs) {
        return {
          conflictDetected: true,
          conflictSummaryFa: `تفاوت مقادیر عددی بین «${primary.title}» و «${other.title}» مشاهده شد.`,
        };
      }
    }

    // Check explicit outdated/deprecated marker paired with another active source
    const outdatedRe = /(منسوخ|باطل|بروزرسانی\s*قدیمی|نسخه\s*قبلی|لغو\s*شده)/;
    if (outdatedRe.test(normA) !== outdatedRe.test(normB)) {
      return {
        conflictDetected: true,
        conflictSummaryFa: `احتمال قدیمی یا متناقض بودن سند بین «${primary.title}» و «${other.title}» شناسایی شد.`,
      };
    }
  }

  return { conflictDetected: false, conflictSummaryFa: null };
}

export async function retrieveAuthorizedKnowledge(params: {
  departmentId: string;
  query: string;
  queryEmbedding?: number[] | null;
  minConfidenceScore?: number;
  limit?: number;
}): Promise<RetrievalPipelineResult> {
  const minScore = params.minConfidenceScore ?? 25;
  const limit = params.limit ?? 5;

  // 1. Determine authorized collections & direct department links BEFORE reading content
  const [deptCollectionRows, activeCollections, directDocRows, directQaRows] =
    await Promise.all([
      db
        .select({ collectionId: departmentKnowledgeCollections.collectionId })
        .from(departmentKnowledgeCollections)
        .where(eq(departmentKnowledgeCollections.departmentId, params.departmentId)),
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
        .where(eq(knowledgeDocumentDepartments.departmentId, params.departmentId)),
      db
        .select({ qaEntryId: knowledgeQaDepartments.qaEntryId })
        .from(knowledgeQaDepartments)
        .where(eq(knowledgeQaDepartments.departmentId, params.departmentId)),
    ]);

  const activeCollectionIds = new Set(activeCollections.map((c) => c.id));
  const authorizedCollectionIds = new Set(
    deptCollectionRows
      .map((r) => r.collectionId)
      .filter((cid) => activeCollectionIds.has(cid))
  );
  const directDocIds = new Set(directDocRows.map((r) => r.documentId));
  const directQaIds = new Set(directQaRows.map((r) => r.qaEntryId));

  // 2. Load authorized non-restricted Q&A entries
  const publishedQas = await db
    .select()
    .from(knowledgeQaEntries)
    .where(
      and(
        eq(knowledgeQaEntries.status, 'published'),
        ne(knowledgeQaEntries.scope, 'restricted')
      )
    );

  const authorizedQas = publishedQas.filter((qa) => {
    if (qa.collectionId && !activeCollectionIds.has(qa.collectionId)) {
      return false;
    }
    if (qa.scope === 'global') return true;
    if (directQaIds.has(qa.id)) return true;
    if (qa.collectionId && authorizedCollectionIds.has(qa.collectionId)) return true;
    return false;
  });

  // 3. Load authorized indexed, enabled, and currently valid documents
  const indexedDocs = await db
    .select({
      id: knowledgeDocuments.id,
      titleFa: knowledgeDocuments.titleFa,
      collectionId: knowledgeDocuments.collectionId,
      scope: knowledgeDocuments.scope,
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
    );

  const authorizedDocs = indexedDocs.filter((doc) => {
    if (doc.collectionId && !activeCollectionIds.has(doc.collectionId)) {
      return false;
    }
    if (doc.scope === 'global') return true;
    if (directDocIds.has(doc.id)) return true;
    if (doc.collectionId && authorizedCollectionIds.has(doc.collectionId)) return true;
    return false;
  });

  const docMap = new Map(authorizedDocs.map((d) => [d.id, d]));
  const authorizedDocIdsList = authorizedDocs.map((d) => d.id);

  const chunkRows =
    authorizedDocIdsList.length > 0
      ? await db
          .select()
          .from(knowledgeChunks)
          .where(
            and(
              inArray(knowledgeChunks.documentId, authorizedDocIdsList),
              eq(knowledgeChunks.isActive, true),
              eq(knowledgeChunks.chunkLevel, 'child')
            )
          )
      : [];

  // 4. Score Q&A entries and document chunks
  const scoredMatches: RetrievedKnowledgeMatch[] = [];

  for (const qa of authorizedQas) {
    const boostTerms = [
      normalizePersianText(qa.question),
      ...qa.alternativeQuestions.map((q) => normalizePersianText(q)),
      ...qa.keywords.map((k) => normalizePersianText(k)),
    ];
    const score = scoreTextRelevance({
      query: params.query,
      candidateNormalizedText: qa.normalizedSearchText,
      extraBoostNormalized: boostTerms,
      queryEmbedding: params.queryEmbedding,
      candidateEmbedding: qa.embeddingJson,
    });
    if (score > 0) {
      scoredMatches.push({
        sourceType: 'qa',
        sourceId: qa.id,
        parentId: qa.id,
        title: qa.question,
        content: sanitizeUntrustedExcerpt(
          `پرسش رسمی: ${qa.question}\nپاسخ رسمی: ${qa.officialAnswer}`
        ),
        score,
        scope: qa.scope,
        updatedAt: qa.updatedAt.toISOString(),
      });
    }
  }

  for (const chunk of chunkRows) {
    const doc = docMap.get(chunk.documentId);
    if (!doc) continue;
    const score = scoreTextRelevance({
      query: params.query,
      candidateNormalizedText: chunk.normalizedContent,
      extraBoostNormalized: [normalizePersianText(doc.titleFa)],
      queryEmbedding: params.queryEmbedding,
      candidateEmbedding: chunk.embeddingJson,
    });
    if (score > 0) {
      scoredMatches.push({
        sourceType: 'document_chunk',
        sourceId: chunk.id,
        parentId: doc.id,
        title: doc.titleFa,
        content: sanitizeUntrustedExcerpt(chunk.content),
        score,
        scope: doc.scope,
        updatedAt: doc.updatedAt.toISOString(),
      });
    }
  }

  scoredMatches.sort((a, b) => b.score - a.score);
  const topMatches = scoredMatches.slice(0, limit);
  const topScore = topMatches[0]?.score ?? 0;

  const conflict = detectKnowledgeConflict(params.query, topMatches, minScore);

  return {
    matches: topMatches,
    topScore,
    conflictDetected: conflict.conflictDetected,
    conflictSummaryFa: conflict.conflictSummaryFa,
  };
}
