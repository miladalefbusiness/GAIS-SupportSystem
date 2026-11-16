import { sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import {
  extractStructuredIdentifiers,
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../normalizer.ts';
import type { LexicalSearchAdapter, LexicalSearchHit } from './interfaces.ts';

function buildSafeOrTsQueryString(tokens: string[]): string {
  const clean = tokens
    .map((t) => t.replace(/['":\\|&!()*<>]/g, ' ').trim())
    .filter((t) => t.length >= 2)
    .slice(0, 14);
  if (clean.length === 0) return '';
  return clean.map((t) => `'${t}':*`).join(' | ');
}

export class PgLexicalSearchAdapter implements LexicalSearchAdapter {
  readonly backendName = 'pg_fts_trgm';

  async searchDocuments(params: {
    authorizedDocumentIds: string[];
    query: string;
    extraQueries?: string[];
    limit: number;
  }): Promise<LexicalSearchHit[]> {
    if (params.authorizedDocumentIds.length === 0) return [];

    const combinedQuery = [params.query, ...(params.extraQueries || [])]
      .filter(Boolean)
      .join(' ');
    const normQuery = normalizePersianForSearch(params.query);
    const tokens = tokenizePersianAndIdentifiers(combinedQuery);
    const identifiers = extractStructuredIdentifiers(combinedQuery);
    const tsQueryExpr = buildSafeOrTsQueryString(tokens);

    if (!normQuery && !tsQueryExpr) return [];

    const docIdArray = sql.join(
      params.authorizedDocumentIds.map((id) => sql`${id}`),
      sql`, `
    );
    const limit = Math.max(1, Math.min(params.limit, 100));

    // PostgreSQL FTS (tsvector GIN) + pg_trgm similarity strictly over pre-authorized child chunks
    const res = await db.execute<{
      id: string;
      document_id: string;
      normalized_content: string;
      fts_rank: number;
      trgm_sim: number;
    }>(sql`
      SELECT
        c.id,
        c.document_id,
        c.normalized_content,
        ${
          tsQueryExpr
            ? sql`COALESCE(ts_rank_cd(c.search_tsv, to_tsquery('simple', ${tsQueryExpr})), 0)`
            : sql`0::float`
        } AS fts_rank,
        GREATEST(
          COALESCE(similarity(left(c.normalized_content, 1200), ${normQuery.slice(0, 300)}), 0),
          COALESCE(word_similarity(${normQuery.slice(0, 180)}, left(c.normalized_content, 1200)), 0)
        ) AS trgm_sim
      FROM knowledge_chunks c
      WHERE c.document_id IN (${docIdArray})
        AND c.is_active = true
        AND c.chunk_level = 'child'
        AND (
          ${
            tsQueryExpr
              ? sql`c.search_tsv @@ to_tsquery('simple', ${tsQueryExpr})`
              : sql`false`
          }
          OR similarity(left(c.normalized_content, 1200), ${normQuery.slice(0, 300)}) > 0.08
          OR word_similarity(${normQuery.slice(0, 180)}, left(c.normalized_content, 1200)) > 0.22
          ${
            normQuery.length >= 4
              ? sql`OR c.normalized_content LIKE ${`%${normQuery.slice(0, 120)}%`}`
              : sql``
          }
        )
      ORDER BY (
        (${tsQueryExpr ? sql`COALESCE(ts_rank_cd(c.search_tsv, to_tsquery('simple', ${tsQueryExpr})), 0) * 1.4` : sql`0`})
        + COALESCE(word_similarity(${normQuery.slice(0, 180)}, left(c.normalized_content, 1200)), 0)
      ) DESC
      LIMIT ${limit}
    `);

    const scored = res.rows.map((row) => {
      const fts = Number(row.fts_rank) || 0;
      const trgm = Number(row.trgm_sim) || 0;
      const content = row.normalized_content || '';

      let exactIdBoost = 0;
      let matchedId = false;
      for (const idTok of identifiers) {
        if (content.includes(idTok)) {
          exactIdBoost += 0.25;
          matchedId = true;
        }
      }
      const phraseBoost =
        normQuery.length >= 5 && content.includes(normQuery) ? 0.3 : 0;

      // Normalize lexical score cleanly to 0..1
      const raw =
        Math.min(0.65, fts * 0.9) +
        Math.min(0.45, trgm * 0.55) +
        Math.min(0.4, exactIdBoost) +
        phraseBoost;
      const score = Math.max(0.01, Math.min(1, Number(raw.toFixed(4))));

      const matchedBy: LexicalSearchHit['matchedBy'] = matchedId
        ? 'exact_identifier'
        : fts > 0.05
        ? 'fts'
        : trgm > 0.1
        ? 'trgm'
        : 'fallback';

      return {
        sourceType: 'document_chunk' as const,
        id: row.id,
        parentId: row.document_id,
        score,
        matchedBy,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
  }

  async searchQaEntries(params: {
    authorizedQaIds: string[];
    query: string;
    extraQueries?: string[];
    limit: number;
  }): Promise<LexicalSearchHit[]> {
    if (params.authorizedQaIds.length === 0) return [];

    const combinedQuery = [params.query, ...(params.extraQueries || [])]
      .filter(Boolean)
      .join(' ');
    const normQuery = normalizePersianForSearch(params.query);
    const tokens = tokenizePersianAndIdentifiers(combinedQuery);
    const identifiers = extractStructuredIdentifiers(combinedQuery);
    const tsQueryExpr = buildSafeOrTsQueryString(tokens);

    if (!normQuery && !tsQueryExpr) return [];

    const qaIdArray = sql.join(
      params.authorizedQaIds.map((id) => sql`${id}`),
      sql`, `
    );
    const limit = Math.max(1, Math.min(params.limit, 100));

    const res = await db.execute<{
      id: string;
      normalized_search_text: string;
      fts_rank: number;
      trgm_sim: number;
    }>(sql`
      SELECT
        q.id,
        q.normalized_search_text,
        ${
          tsQueryExpr
            ? sql`COALESCE(ts_rank_cd(q.search_tsv, to_tsquery('simple', ${tsQueryExpr})), 0)`
            : sql`0::float`
        } AS fts_rank,
        GREATEST(
          COALESCE(similarity(left(q.normalized_search_text, 1200), ${normQuery.slice(0, 300)}), 0),
          COALESCE(word_similarity(${normQuery.slice(0, 180)}, left(q.normalized_search_text, 1200)), 0)
        ) AS trgm_sim
      FROM knowledge_qa_entries q
      WHERE q.id IN (${qaIdArray})
        AND (
          ${
            tsQueryExpr
              ? sql`q.search_tsv @@ to_tsquery('simple', ${tsQueryExpr})`
              : sql`false`
          }
          OR similarity(left(q.normalized_search_text, 1200), ${normQuery.slice(0, 300)}) > 0.08
          OR word_similarity(${normQuery.slice(0, 180)}, left(q.normalized_search_text, 1200)) > 0.22
          ${
            normQuery.length >= 4
              ? sql`OR q.normalized_search_text LIKE ${`%${normQuery.slice(0, 120)}%`}`
              : sql``
          }
        )
      ORDER BY (
        (${tsQueryExpr ? sql`COALESCE(ts_rank_cd(q.search_tsv, to_tsquery('simple', ${tsQueryExpr})), 0) * 1.4` : sql`0`})
        + COALESCE(word_similarity(${normQuery.slice(0, 180)}, left(q.normalized_search_text, 1200)), 0)
      ) DESC
      LIMIT ${limit}
    `);

    const scored = res.rows.map((row) => {
      const fts = Number(row.fts_rank) || 0;
      const trgm = Number(row.trgm_sim) || 0;
      const content = row.normalized_search_text || '';

      let exactIdBoost = 0;
      let matchedId = false;
      for (const idTok of identifiers) {
        if (content.includes(idTok)) {
          exactIdBoost += 0.25;
          matchedId = true;
        }
      }
      const phraseBoost =
        normQuery.length >= 5 && content.includes(normQuery) ? 0.35 : 0;

      const raw =
        Math.min(0.65, fts * 0.9) +
        Math.min(0.45, trgm * 0.55) +
        Math.min(0.4, exactIdBoost) +
        phraseBoost;
      const score = Math.max(0.01, Math.min(1, Number(raw.toFixed(4))));

      const matchedBy: LexicalSearchHit['matchedBy'] = matchedId
        ? 'exact_identifier'
        : fts > 0.05
        ? 'fts'
        : trgm > 0.1
        ? 'trgm'
        : 'fallback';

      return {
        sourceType: 'qa' as const,
        id: row.id,
        parentId: row.id,
        score,
        matchedBy,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
  }
}

let cachedLexicalAdapter: LexicalSearchAdapter | null = null;

export function getLexicalSearchAdapter(): LexicalSearchAdapter {
  if (!cachedLexicalAdapter) {
    cachedLexicalAdapter = new PgLexicalSearchAdapter();
  }
  return cachedLexicalAdapter;
}
