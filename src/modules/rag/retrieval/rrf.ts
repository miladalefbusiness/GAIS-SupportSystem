import type { LexicalSearchHit, VectorSearchHit } from '../stores/interfaces.ts';

export interface RrfFusionConfig {
  k?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  qaAuthorityMultiplier?: number;
  limit?: number;
}

export interface FusedCandidate {
  key: string; // `${sourceType}:${id}`
  sourceType: 'document_chunk' | 'qa';
  id: string;
  parentId: string;
  rrfScore: number;
  normalizedRrfScore: number; // 0..100 scaled score
  lexicalRank: number | null;
  lexicalScore: number | null;
  semanticRank: number | null;
  semanticScore: number | null;
  matchedBy: string[];
}

/**
 * Combines heterogeneous lexical & semantic ranked result lists using
 * weighted Reciprocal Rank Fusion (RRF):
 *   RRF(d) = sum_i weight_i / (k + rank_i(d))
 */
export function fuseWithReciprocalRankFusion(params: {
  lexicalLists: LexicalSearchHit[][];
  semanticLists: Array<{
    sourceType: 'document_chunk' | 'qa';
    hits: VectorSearchHit[];
  }>;
  config?: RrfFusionConfig;
}): FusedCandidate[] {
  const k = Math.max(1, params.config?.k ?? 60);
  const lexicalWeight = params.config?.lexicalWeight ?? 1.0;
  const semanticWeight = params.config?.semanticWeight ?? 1.05;
  const qaMultiplier = params.config?.qaAuthorityMultiplier ?? 1.08;
  const limit = Math.max(1, params.config?.limit ?? 20);

  const map = new Map<string, FusedCandidate>();

  const ensureEntry = (
    sourceType: 'document_chunk' | 'qa',
    id: string,
    parentId: string
  ): FusedCandidate => {
    const key = `${sourceType}:${id}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        sourceType,
        id,
        parentId,
        rrfScore: 0,
        normalizedRrfScore: 0,
        lexicalRank: null,
        lexicalScore: null,
        semanticRank: null,
        semanticScore: null,
        matchedBy: [],
      };
      map.set(key, entry);
    }
    return entry;
  };

  for (const list of params.lexicalLists) {
    for (const hit of list) {
      const entry = ensureEntry(hit.sourceType, hit.id, hit.parentId);
      const contrib = lexicalWeight / (k + hit.rank);
      entry.rrfScore += contrib;
      if (entry.lexicalRank === null || hit.rank < entry.lexicalRank) {
        entry.lexicalRank = hit.rank;
      }
      if (entry.lexicalScore === null || hit.score > entry.lexicalScore) {
        entry.lexicalScore = hit.score;
      }
      if (!entry.matchedBy.includes(hit.matchedBy)) {
        entry.matchedBy.push(hit.matchedBy);
      }
    }
  }

  for (const semList of params.semanticLists) {
    for (const hit of semList.hits) {
      const entry = ensureEntry(semList.sourceType, hit.id, hit.parentId);
      const contrib = semanticWeight / (k + hit.rank);
      entry.rrfScore += contrib;
      if (entry.semanticRank === null || hit.rank < entry.semanticRank) {
        entry.semanticRank = hit.rank;
      }
      if (entry.semanticScore === null || hit.similarity > entry.semanticScore) {
        entry.semanticScore = hit.similarity;
      }
      if (!entry.matchedBy.includes('vector')) {
        entry.matchedBy.push('vector');
      }
    }
  }

  const all = Array.from(map.values()).map((c) => {
    const adjustedRrf =
      c.sourceType === 'qa' ? c.rrfScore * qaMultiplier : c.rrfScore;

    // Combine rank consensus with intrinsic signal strength into a bounded 0..100 confidence indicator
    const singleListMax = Math.max(lexicalWeight, semanticWeight) / (k + 1);
    const dualListMax = (lexicalWeight + semanticWeight) / (k + 1);
    const rankRatio = Math.min(
      1,
      adjustedRrf / Math.max(0.0001, singleListMax * 0.85 + dualListMax * 0.15)
    );
    const bestIntrinsic = Math.max(
      c.lexicalScore ?? 0,
      c.semanticScore ?? 0
    );
    const dualBonus =
      c.lexicalRank !== null && c.semanticRank !== null ? 0.12 : 0;

    const scaled = Math.round(
      Math.min(100, (rankRatio * 0.55 + bestIntrinsic * 0.45 + dualBonus) * 100)
    );

    return {
      ...c,
      rrfScore: Number(adjustedRrf.toFixed(6)),
      normalizedRrfScore: Math.max(1, scaled),
    };
  });

  all.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return b.normalizedRrfScore - a.normalizedRrfScore;
  });

  return all.slice(0, limit);
}
