import type { AiProviderAdapter } from '../../ai/provider.ts';
import {
  extractStructuredIdentifiers,
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../normalizer.ts';

export type QueryTransformType =
  | 'normalized'
  | 'contextualized'
  | 'rewritten'
  | 'expanded'
  | 'decomposed';

export interface GeneratedSearchQuery {
  query: string;
  type: QueryTransformType;
  reason: string;
}

export interface QueryTransformationTrace {
  originalQuery: string;
  normalizedQuery: string;
  contextualizedQuery: string;
  identifiers: string[];
  subQueries: string[];
  generatedQueries: GeneratedSearchQuery[];
  usedLlmTransform: boolean;
}

const FILLER_PREFIX_RE =
  /^(?:سلام|با\s*سلام|درود|خسته\s*نباشید|وقت\s*بخیر|لطفاً|لطفا|ببخشید|می\s*خواستم\s*بدونم|میخواستم\s*بپرسم|سوال\s*داشتم|میشه\s*بگید|ممنون\s*میشم\s*بفرمایید)[\s،,!.:-]+/giu;

const FOLLOWUP_PRONOUN_RE =
  /(?:^|\s)(آن|اون|این\s*مورد|همین|شرایطش|مهلتش|مبلغش|هزینه‌اش|هزینه\s*اش|مدارکش|چطوره|چقدره|چی\s*شد|ادامه)(?:\s|$|[؟?])/u;

const PERSIAN_SYNONYM_GROUPS: Array<{ triggers: string[]; expansions: string[] }> = [
  {
    triggers: ['شهریه', 'هزینه', 'تعرفه', 'مبلغ', 'پرداخت', 'قسط'],
    expansions: ['تعرفه', 'هزینه', 'واریز', 'مبلغ'],
  },
  {
    triggers: ['استرداد', 'عودت', 'بازگشت وجه', 'برگشت پول', 'انصراف'],
    expansions: ['استرداد وجه', 'انصراف', 'عودت'],
  },
  {
    triggers: ['شبا', 'شماره حساب', 'کارت', 'واریز'],
    expansions: ['شماره شبا', 'حساب بانکی', 'واریز'],
  },
  {
    triggers: ['تمدید', 'ثبت نام', 'ثبت‌نام', 'مهلت', 'زمان'],
    expansions: ['مهلت', 'زمان بندی', 'تمدید'],
  },
  {
    triggers: ['خطا', 'ارور', 'مشکل', 'اختلال', 'ورود'],
    expansions: ['کد خطا', 'رفع مشکل', 'راهنما'],
  },
  {
    triggers: ['بیمه', 'درمان', 'خسارت', 'پزشکی'],
    expansions: ['بیمه نامه', 'خسارت', 'مدارک'],
  },
  {
    triggers: ['مرخصی', 'ماموریت', 'کارگزینی', 'پرسنلی'],
    expansions: ['آیین نامه', 'مرخصی', 'درخواست'],
  },
  {
    triggers: ['ساعت', 'ساعتی', 'ساعات', 'روزها', 'پاسخگویی'],
    expansions: ['ساعات کاری', 'پشتیبانی', 'پاسخگویی', 'شنبه تا چهارشنبه'],
  },
];

function stripConversationalFiller(query: string): string {
  let out = query.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(FILLER_PREFIX_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/\s+(ممنون|سپاسگزارم|تشکر|لطفاً راهنمایی کنید)[.!؟\s]*$/giu, '')
    .trim();
}

export function decomposeCompoundQuery(query: string): string[] {
  const cleaned = stripConversationalFiller(query);
  if (!cleaned) return [];

  // Split by question marks, semicolons, or explicit Persian compound connectors
  const byQuestionOrSemi = cleaned
    .split(/[؟?;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const parts: string[] = [];
  for (const segment of byQuestionOrSemi.length > 0 ? byQuestionOrSemi : [cleaned]) {
    const subParts = segment
      .split(/\s+(?:و همچنین|و همینطور|و نیز|علاوه بر این|؛)\s+/u)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
    if (subParts.length > 1) {
      parts.push(...subParts);
    } else {
      parts.push(segment);
    }
  }

  return Array.from(new Set(parts)).slice(0, 4);
}

export function expandPersianQueryTerms(normQuery: string): string | null {
  const addedTerms: string[] = [];
  for (const group of PERSIAN_SYNONYM_GROUPS) {
    const matched = group.triggers.some((t) =>
      normQuery.includes(normalizePersianForSearch(t))
    );
    if (matched) {
      for (const exp of group.expansions) {
        const expNorm = normalizePersianForSearch(exp);
        if (!normQuery.includes(expNorm) && !addedTerms.includes(expNorm)) {
          addedTerms.push(expNorm);
        }
      }
    }
  }
  if (addedTerms.length === 0) return null;
  return `${normQuery} ${addedTerms.slice(0, 4).join(' ')}`.trim();
}

export function contextualizeWithHistory(
  query: string,
  conversationHistory: Array<{ senderRole: string; content: string }>
): { contextualized: string; wasContextualized: boolean } {
  const norm = normalizePersianForSearch(query);
  const tokens = tokenizePersianAndIdentifiers(norm);
  const looksFollowUp =
    FOLLOWUP_PRONOUN_RE.test(query) || tokens.length <= 3;

  if (!looksFollowUp || conversationHistory.length === 0) {
    return { contextualized: query, wasContextualized: false };
  }

  const prevCustomerTurns = conversationHistory
    .filter((m) => m.senderRole === 'customer' && m.content.trim() !== query.trim())
    .slice(-2);

  if (prevCustomerTurns.length === 0) {
    return { contextualized: query, wasContextualized: false };
  }

  const anchorTokens = tokenizePersianAndIdentifiers(
    prevCustomerTurns.map((t) => t.content).join(' ')
  ).slice(0, 5);

  if (anchorTokens.length === 0) {
    return { contextualized: query, wasContextualized: false };
  }

  const missingAnchors = anchorTokens.filter((t) => !norm.includes(t));
  if (missingAnchors.length === 0) {
    return { contextualized: query, wasContextualized: false };
  }

  return {
    contextualized: `${query.trim()} (${missingAnchors.slice(0, 3).join(' ')})`,
    wasContextualized: true,
  };
}

export async function transformQuery(params: {
  originalQuery: string;
  conversationHistory?: Array<{ senderRole: string; content: string }>;
  enableExpansion?: boolean;
  enableDecomposition?: boolean;
  enableLlmRewrite?: boolean;
  adapter?: AiProviderAdapter | null;
  maxQueries?: number;
}): Promise<QueryTransformationTrace> {
  const maxQueries = Math.max(1, Math.min(params.maxQueries ?? 4, 6));
  const originalQuery = params.originalQuery.trim();
  const normalizedQuery = normalizePersianForSearch(originalQuery);
  const identifiers = extractStructuredIdentifiers(originalQuery);

  const generatedQueries: GeneratedSearchQuery[] = [];
  const seenNorm = new Set<string>();

  const pushUnique = (
    rawQuery: string,
    type: QueryTransformType,
    reason: string
  ) => {
    const clean = rawQuery.trim();
    const norm = normalizePersianForSearch(clean);
    if (!norm || seenNorm.has(norm) || generatedQueries.length >= maxQueries) {
      return;
    }
    seenNorm.add(norm);
    generatedQueries.push({ query: clean, type, reason });
  };

  // 1. Conversation-aware contextualization
  const ctx = contextualizeWithHistory(
    originalQuery,
    params.conversationHistory || []
  );
  const contextualizedQuery = ctx.contextualized;

  if (ctx.wasContextualized) {
    pushUnique(
      contextualizedQuery,
      'contextualized',
      'بازنویسی وابسته به تاریخچه گفت‌وگو'
    );
  }

  // 2. Rewritten concise query (strip greetings/filler)
  const stripped = stripConversationalFiller(contextualizedQuery);
  if (
    stripped &&
    normalizePersianForSearch(stripped) !== normalizedQuery
  ) {
    pushUnique(stripped, 'rewritten', 'حذف عبارات محاوره‌ای و تمرکز بر کلیدواژه');
  }

  // Always retain canonical normalized query
  pushUnique(normalizedQuery || originalQuery, 'normalized', 'نرمال‌سازی کاراکترها و ارقام فارسی');

  // 3. Query Decomposition for compound / multi-question prompts
  const subQueries =
    params.enableDecomposition !== false
      ? decomposeCompoundQuery(originalQuery)
      : [originalQuery];

  if (subQueries.length > 1) {
    for (const sub of subQueries) {
      pushUnique(sub, 'decomposed', 'تجزیه پرسش چندبخشی به زیرپرسش مستقل');
    }
  }

  // 4. Domain synonym / variant expansion
  if (params.enableExpansion !== false) {
    const expanded = expandPersianQueryTerms(
      normalizePersianForSearch(contextualizedQuery)
    );
    if (expanded) {
      pushUnique(expanded, 'expanded', 'بسط پرس‌وجو با هم‌معنی‌های سازمانی');
    }
  }

  // 5. Optional bounded LLM query rewriting when enabled
  let usedLlmTransform = false;
  if (params.enableLlmRewrite && params.adapter && generatedQueries.length < maxQueries) {
    try {
      const llmRes = await params.adapter.generateGroundedReply({
        systemInstruction:
          'You rewrite Persian support questions into up to 2 short, formal search queries. Output ONLY a JSON array of strings, nothing else.',
        userContent: `Question: ${contextualizedQuery.slice(0, 400)}`,
        timeoutMs: 4500,
        maxOutputTokens: 120,
        temperature: 0,
      });
      const jsonMatch = llmRes.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          usedLlmTransform = true;
          for (const item of parsed) {
            if (typeof item === 'string' && item.trim().length >= 3) {
              pushUnique(item.trim(), 'rewritten', 'بازنویسی هوشمند مدل برای بازیابی چندمسیره');
            }
          }
        }
      }
    } catch {
      // Fall back gracefully to deterministic transforms
    }
  }

  return {
    originalQuery,
    normalizedQuery,
    contextualizedQuery,
    identifiers,
    subQueries,
    generatedQueries,
    usedLlmTransform,
  };
}
