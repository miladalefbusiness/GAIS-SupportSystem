import {
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../rag/normalizer.ts';

export function normalizePersianText(input: string): string {
  return normalizePersianForSearch(input);
}

export function tokenizeSearchTerms(input: string): string[] {
  return tokenizePersianAndIdentifiers(input);
}

export function chunkDocumentText(
  rawText: string,
  options?: { maxChars?: number; overlapChars?: number }
): string[] {
  const maxChars = options?.maxChars ?? 900;
  const overlapChars = options?.overlapChars ?? 140;

  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current.trim()) {
        flushCurrent();
        current = '';
      }
      let cursor = 0;
      while (cursor < para.length) {
        let end = Math.min(cursor + maxChars, para.length);
        if (end < para.length) {
          const lastSpace = para.lastIndexOf(' ', end);
          if (lastSpace > cursor + Math.floor(maxChars * 0.5)) {
            end = lastSpace;
          }
        }
        const slice = para.slice(cursor, end).trim();
        if (slice) chunks.push(slice);
        if (end >= para.length) break;
        cursor = Math.max(cursor + 1, end - overlapChars);
      }
      continue;
    }

    if ((current ? `${current}\n\n${para}` : para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      flushCurrent();
      const tail =
        current.length > overlapChars
          ? current.slice(current.length - overlapChars).trim()
          : '';
      current = tail ? `${tail}\n\n${para}` : para;
    }
  }

  flushCurrent();
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function scoreTextRelevance(params: {
  query: string;
  candidateNormalizedText: string;
  extraBoostNormalized?: string[];
  queryEmbedding?: number[] | null;
  candidateEmbedding?: number[] | null;
}): number {
  const normQuery = normalizePersianText(params.query);
  if (!normQuery || !params.candidateNormalizedText) return 0;

  const queryTerms = tokenizeSearchTerms(params.query);
  const candidateTokens = new Set(tokenizeSearchTerms(params.candidateNormalizedText));

  let score = 0;

  if (normQuery.length >= 5 && params.candidateNormalizedText.includes(normQuery)) {
    score += 45;
  }

  if (params.extraBoostNormalized) {
    for (const boost of params.extraBoostNormalized) {
      if (!boost) continue;
      if (boost === normQuery) {
        score += 55;
        break;
      }
      if (normQuery.length >= 5 && (boost.includes(normQuery) || normQuery.includes(boost))) {
        score += 30;
        break;
      }
    }
  }

  if (queryTerms.length > 0) {
    let matchedTerms = 0;
    for (const term of queryTerms) {
      if (candidateTokens.has(term) || params.candidateNormalizedText.includes(term)) {
        matchedTerms++;
      }
    }
    const coverage = matchedTerms / queryTerms.length;
    score += Math.round(coverage * 55);

    if (queryTerms.length >= 2) {
      let bigramHits = 0;
      for (let i = 0; i < queryTerms.length - 1; i++) {
        const bg = `${queryTerms[i]} ${queryTerms[i + 1]}`;
        if (params.candidateNormalizedText.includes(bg)) {
          bigramHits++;
        }
      }
      score += Math.min(20, bigramHits * 10);
    }
  }

  if (
    params.queryEmbedding &&
    params.candidateEmbedding &&
    params.queryEmbedding.length === params.candidateEmbedding.length
  ) {
    const sim = cosineSimilarity(params.queryEmbedding, params.candidateEmbedding);
    if (sim > 0.35) {
      score += Math.round((sim - 0.35) * 60);
    }
  }

  return Math.max(0, Math.min(100, score));
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|system)\s+(rules?|instructions?|prompts?)/i,
  /reveal\s+(your\s+)?(system\s+prompt|api\s*key|secret|credentials?|database)/i,
  /you\s+are\s+now\s+(in\s+)?(developer|admin|jailbreak|dan)\s+mode/i,
  /override\s+security/i,
  /دستورالعمل\s*(های)?\s*(قبلی|سیستم|اصلی)\s*(را)?\s*(نادیده|لغو|فراموش)/i,
  /(کلید\s*api|پرامپت\s*سیستم|رمز\s*عبور\s*مدیر|دسترسی\s*ادمین)\s*(را)?\s*(بگو|نمایش|ارسال|افشا)/i,
  /از\s*سایر\s*دپارتمان\s*ها\s*(اطلاعات|محرمانه|فایل)/i,
];

export function detectPromptInjectionAttempt(text: string): boolean {
  const normalized = normalizePersianText(text);
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text) || re.test(normalized));
}

export function sanitizeUntrustedExcerpt(text: string): string {
  return text
    .replace(/<\/?(system|assistant|developer|instructions?|untrusted_[^>]+|approved_[^>]+)>/gi, '')
    .trim();
}
