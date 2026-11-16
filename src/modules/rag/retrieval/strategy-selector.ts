import {
  extractStructuredIdentifiers,
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../normalizer.ts';
import { decomposeCompoundQuery } from './query-transformer.ts';

export type RetrievalStrategy =
  | 'direct_lexical'
  | 'semantic'
  | 'hybrid'
  | 'multi_query'
  | 'decomposed'
  | 'iterative';

export interface StrategySelectionResult {
  strategy: RetrievalStrategy;
  reasonFa: string;
  enableLexical: boolean;
  enableSemantic: boolean;
  enableExpansion: boolean;
  enableDecomposition: boolean;
  candidateMultiplier: number;
}

export function selectRetrievalStrategy(params: {
  query: string;
  conversationHistory?: Array<{ senderRole: string; content: string }>;
  hasEmbeddingModel: boolean;
  forcedStrategy?: RetrievalStrategy | null;
  preferSemanticForConceptual?: boolean;
}): StrategySelectionResult {
  if (params.forcedStrategy) {
    const s = params.forcedStrategy;
    return {
      strategy: s,
      reasonFa: 'انتخاب صریح استراتژی از پیکربندی آزمایش یا سیاست دپارتمان',
      enableLexical: s !== 'semantic' || !params.hasEmbeddingModel,
      enableSemantic: params.hasEmbeddingModel && s !== 'direct_lexical',
      enableExpansion: s === 'multi_query' || s === 'hybrid' || s === 'iterative',
      enableDecomposition: s === 'decomposed' || s === 'iterative',
      candidateMultiplier: s === 'multi_query' || s === 'decomposed' || s === 'iterative' ? 2 : 1,
    };
  }

  const norm = normalizePersianForSearch(params.query);
  const tokens = tokenizePersianAndIdentifiers(norm);
  const identifiers = extractStructuredIdentifiers(params.query);
  const subQueries = decomposeCompoundQuery(params.query);
  const hasHistoryFollowUp =
    (params.conversationHistory?.length ?? 0) > 0 && tokens.length <= 4;

  // 1. Compound / multi-part question -> decompose into atomic sub-queries
  if (subQueries.length > 1) {
    return {
      strategy: 'decomposed',
      reasonFa: `پرسش چندبخشی (${subQueries.length} زیرسؤال) تشخیص داده شد؛ تجزیه و ادغام RRF فعال شد.`,
      enableLexical: true,
      enableSemantic: params.hasEmbeddingModel,
      enableExpansion: true,
      enableDecomposition: true,
      candidateMultiplier: 2,
    };
  }

  // 2. Short code / regulation number / identifier exact lookup -> direct lexical
  if (identifiers.length > 0 && tokens.length <= 5) {
    return {
      strategy: 'direct_lexical',
      reasonFa: 'وجود شناسه یا کد دقیق در پرسش کوتاه؛ جست‌وجوی مستقیم واژگانی و شناسه‌ها انتخاب شد.',
      enableLexical: true,
      enableSemantic: false,
      enableExpansion: false,
      enableDecomposition: false,
      candidateMultiplier: 1,
    };
  }

  // 3. Elliptical / vague / follow-up queries -> multi-query expansion + contextualization
  if (hasHistoryFollowUp || tokens.length <= 3) {
    return {
      strategy: 'multi_query',
      reasonFa: 'پرسش کوتاه یا وابسته به گفت‌وگوی قبلی؛ بازیابی چندپرس‌وجویی با بسط زمینه انتخاب شد.',
      enableLexical: true,
      enableSemantic: params.hasEmbeddingModel,
      enableExpansion: true,
      enableDecomposition: false,
      candidateMultiplier: 2,
    };
  }

  // 4. Conceptual paraphrase without exact identifiers when semantic index is available and preferred
  if (
    params.hasEmbeddingModel &&
    params.preferSemanticForConceptual &&
    identifiers.length === 0 &&
    tokens.length >= 8
  ) {
    return {
      strategy: 'semantic',
      reasonFa: 'پرسش مفهومی بدون کد اختصاصی؛ جست‌وجوی معنایی برداری انتخاب شد.',
      enableLexical: false,
      enableSemantic: true,
      enableExpansion: false,
      enableDecomposition: false,
      candidateMultiplier: 1,
    };
  }

  // 5. No embedding configured -> lexical + expansion fallback
  if (!params.hasEmbeddingModel) {
    return {
      strategy: tokens.length >= 6 ? 'multi_query' : 'direct_lexical',
      reasonFa: 'مدل Embedding فعال نیست؛ بازیابی واژگانی پیشرفته PostgreSQL FTS + Trigram انتخاب شد.',
      enableLexical: true,
      enableSemantic: false,
      enableExpansion: tokens.length >= 4,
      enableDecomposition: false,
      candidateMultiplier: tokens.length >= 6 ? 2 : 1,
    };
  }

  // 6. Standard enterprise default -> Hybrid (Lexical FTS/Trgm + pgvector Semantic via RRF)
  return {
    strategy: 'hybrid',
    reasonFa: 'پرسش استاندارد سازمانی؛ ترکیب جست‌وجوی واژگانی و برداری با ادغام RRF انتخاب شد.',
    enableLexical: true,
    enableSemantic: true,
    enableExpansion: true,
    enableDecomposition: false,
    candidateMultiplier: 1,
  };
}
