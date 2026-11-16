import type { AiProviderAdapter } from '../../ai/provider.ts';
import {
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../normalizer.ts';
import {
  runAdvancedRetrieval,
  type AdvancedRetrievalResult,
  type RetrievedEvidenceItem,
} from '../retrieval/engine.ts';
import { expandPersianQueryTerms } from '../retrieval/query-transformer.ts';
import type { RetrievalStrategy } from '../retrieval/strategy-selector.ts';

export type CragDecision = 'relevant' | 'ambiguous' | 'insufficient';

export type CragActionType =
  | 'rewrite_query'
  | 'generate_alternative_queries'
  | 'expand_parent_sections'
  | 'decompose_query'
  | 'rerun_hybrid_retrieval'
  | 'apply_reranking'
  | 'abstain_and_escalate';

export type CragActionOutcome =
  | 'proceed_to_generation'
  | 'clarify_with_user'
  | 'abstain_insufficient'
  | 'abstain_conflicting';

export interface CragCriteriaScores {
  relevance: number; // 0..100
  sufficiency: number; // 0..100
  consistency: number; // 0..100
  authorization: number; // 0 | 100
  currency: number; // 0 | 100
  specificity: number; // 0..100
}

export interface CragEvaluation {
  decision: CragDecision;
  overallConfidence: number; // 0..100
  criteria: CragCriteriaScores;
  missingFacets: string[];
  reasonFa: string;
  evaluatedBy: 'deterministic' | 'hybrid_llm';
}

export interface CragStepRecord {
  iteration: number;
  decisionBefore: CragDecision;
  actionsTaken: CragActionType[];
  queriesTried: string[];
  strategyUsed: RetrievalStrategy;
  candidateCountAfter: number;
  topScoreAfter: number;
  decisionAfter: CragDecision;
  durationMs: number;
  reasonFa: string;
}

export interface CragBudgetConfig {
  maxIterations: number;
  maxModelCalls: number;
  timeoutBudgetMs: number;
  minConfidenceScore: number;
  enableLlmJudge: boolean;
  enableLlmRerankOnCorrection: boolean;
}

export interface CragControllerOptions {
  departmentId: string;
  query: string;
  conversationHistory?: Array<{ senderRole: string; content: string }>;
  embeddingModel?: string | null;
  queryEmbedding?: number[] | null;
  embedder?: ((text: string) => Promise<number[] | null>) | null;
  adapter?: AiProviderAdapter | null;
  forcedStrategy?: RetrievalStrategy | null;
  rerankerMode?: 'none' | 'cross_feature' | 'llm' | 'http_cross_encoder';
  budget?: Partial<CragBudgetConfig>;
  initialRetrieval?: AdvancedRetrievalResult;
}

export interface CragControllerResult {
  finalDecision: CragDecision;
  actionOutcome: CragActionOutcome;
  evaluation: CragEvaluation;
  evidence: RetrievedEvidenceItem[];
  topScore: number;
  conflictDetected: boolean;
  conflictSummaryFa: string | null;
  correctiveSteps: CragStepRecord[];
  iterationsUsed: number;
  modelCallsUsed: number;
  totalLatencyMs: number;
  budgetExhausted: boolean;
  clarificationPromptFa: string | null;
  initialRetrievalTrace: AdvancedRetrievalResult['trace'];
  finalRetrievalTrace: AdvancedRetrievalResult['trace'];
}

const DEFAULT_CRAG_BUDGET: CragBudgetConfig = {
  maxIterations: 2,
  maxModelCalls: 2,
  timeoutBudgetMs: 9000,
  minConfidenceScore: 25,
  enableLlmJudge: false,
  enableLlmRerankOnCorrection: true,
};

function sanitizeBudget(input?: Partial<CragBudgetConfig>): CragBudgetConfig {
  return {
    maxIterations: Math.max(0, Math.min(input?.maxIterations ?? DEFAULT_CRAG_BUDGET.maxIterations, 3)),
    maxModelCalls: Math.max(0, Math.min(input?.maxModelCalls ?? DEFAULT_CRAG_BUDGET.maxModelCalls, 4)),
    timeoutBudgetMs: Math.max(500, Math.min(input?.timeoutBudgetMs ?? DEFAULT_CRAG_BUDGET.timeoutBudgetMs, 25000)),
    minConfidenceScore: Math.max(5, Math.min(input?.minConfidenceScore ?? DEFAULT_CRAG_BUDGET.minConfidenceScore, 95)),
    enableLlmJudge: input?.enableLlmJudge ?? DEFAULT_CRAG_BUDGET.enableLlmJudge,
    enableLlmRerankOnCorrection:
      input?.enableLlmRerankOnCorrection ?? DEFAULT_CRAG_BUDGET.enableLlmRerankOnCorrection,
  };
}

/**
 * Evaluates retrieved evidence across all 6 mandatory CRAG criteria:
 * relevance, sufficiency, consistency, authorization, currency, and specificity.
 */
export function evaluateEvidenceWithCrag(params: {
  query: string;
  retrieval: AdvancedRetrievalResult;
  minConfidenceScore: number;
}): CragEvaluation {
  const { query, retrieval, minConfidenceScore } = params;
  const matches = retrieval.matches;

  if (matches.length === 0) {
    return {
      decision: 'insufficient',
      overallConfidence: 0,
      criteria: {
        relevance: 0,
        sufficiency: 0,
        consistency: 100,
        authorization: 100,
        currency: 100,
        specificity: 0,
      },
      missingFacets: ['هیچ سند یا پرسش‌وپاسخ مرتبط و مجازی یافت نشد'],
      reasonFa: 'هیچ مدرک معتبری در مخزن دانش مجاز دپارتمان برای پاسخ به این پرسش پیدا نشد.',
      evaluatedBy: 'deterministic',
    };
  }

  // 1. Authorization check (must NEVER pass restricted/unauthorized items)
  const allAuthorized = matches.every(
    (m) =>
      (m.scope === 'global' || m.scope === 'department') &&
      m.classification !== 'internal_restricted'
  );
  const authorization = allAuthorized ? 100 : 0;

  // 2. Currency / validity check (must ONLY use 'current' items)
  const allCurrent = matches.every((m) => m.validityStatus === 'current');
  const currency = allCurrent ? 100 : 0;

  // 3. Consistency check (conflict detection)
  const consistency = retrieval.conflictDetected ? 15 : 100;

  // 4. Relevance check (query token + identifier coverage + score strength)
  const queryTerms = tokenizePersianAndIdentifiers(query).filter((t) => t.length >= 2);
  const topScore = retrieval.topScore;
  const top3 = matches.slice(0, 3);
  const combinedNormText = normalizePersianForSearch(
    top3.map((m) => `${m.title} ${m.content}`).join(' ')
  );

  let termHits = 0;
  const missingTerms: string[] = [];
  for (const term of queryTerms) {
    const stem =
      term.length >= 5 && (term.endsWith('ها') || term.endsWith('ات'))
        ? term.slice(0, -2)
        : term.length >= 4 && term.endsWith('ی')
        ? term.slice(0, -1)
        : term;
    if (
      combinedNormText.includes(term) ||
      (stem.length >= 3 && combinedNormText.includes(stem))
    ) {
      termHits++;
    } else {
      missingTerms.push(term);
    }
  }
  const termCoverage = queryTerms.length > 0 ? termHits / queryTerms.length : 1;

  // Identifier coverage bonus/penalty (e.g. ISO-27001, ERR-403, dates)
  const identifiers = retrieval.trace.queryTransform.identifiers;
  let idCoverage = 1;
  if (identifiers.length > 0) {
    const idHits = identifiers.filter((id) =>
      combinedNormText.includes(normalizePersianForSearch(id))
    ).length;
    idCoverage = idHits / identifiers.length;
  }

  const relevance = Math.round(
    Math.min(100, topScore * 0.55 + termCoverage * 35 + idCoverage * 10)
  );

  // 5. Sufficiency check: do we have rich content & coverage for decomposed parts?
  const strongMatches = matches.filter((m) => m.score >= minConfidenceScore);
  const totalContentLen = top3.reduce((acc, m) => acc + m.content.trim().length, 0);
  const decomposedSubqueries = retrieval.trace.queryTransform.generatedQueries.filter(
    (g) => g.type === 'decomposed'
  );
  let subQueryCoverage = 1;
  if (decomposedSubqueries.length >= 2) {
    let coveredSubs = 0;
    for (const sub of decomposedSubqueries) {
      const subTerms = tokenizePersianAndIdentifiers(sub.query).filter((t) => t.length >= 2);
      if (subTerms.length === 0) {
        coveredSubs++;
        continue;
      }
      const subHits = subTerms.filter((t) => combinedNormText.includes(t)).length;
      if (subHits / subTerms.length >= 0.45) {
        coveredSubs++;
      }
    }
    subQueryCoverage = coveredSubs / decomposedSubqueries.length;
  }

  const lengthScore = Math.min(1, totalContentLen / 180);
  const countScore = Math.min(1, strongMatches.length / 2);
  const sufficiency = Math.round(
    (lengthScore * 0.4 + countScore * 0.25 + subQueryCoverage * 0.35) * 100
  );

  // 6. Specificity check: concrete details (numbers, steps, rules, or authoritative Q&A) vs heading-only stubs
  const hasQaAuthority = top3.some(
    (m) => m.sourceType === 'qa' && m.score >= minConfidenceScore
  );
  const hasConcreteDetail = top3.some((m) => {
    const body = normalizePersianForSearch(m.content);
    const hasDigitOrStep = /\d+|گام|مرحله|شرایط|ماده|تبصره|موظف|مهلت|الزامی|می توانید|نباید/.test(
      body
    );
    return body.length >= 45 && (hasDigitOrStep || m.expandedFromParent);
  });
  const specificity = hasQaAuthority
    ? 92
    : hasConcreteDetail
    ? 85
    : totalContentLen >= 60
    ? 55
    : 20;

  const missingFacets: string[] = [];
  if (!allAuthorized) missingFacets.push('خطای مرزبندی مجوز دسترسی');
  if (!allCurrent) missingFacets.push('وجود سند منسوخ یا منقضی‌شده');
  if (retrieval.conflictDetected) {
    missingFacets.push(retrieval.conflictSummaryFa || 'تعارض اطلاعات بین اسناد');
  }
  if (identifiers.length > 0 && idCoverage < 1) {
    missingFacets.push('شناسه یا کد دقیق پرسش در اسناد یافت نشد');
  }
  if (subQueryCoverage < 0.8 && decomposedSubqueries.length >= 2) {
    missingFacets.push('برخی بخش‌های پرسش چندبخشی پوشش داده نشده است');
  }
  if (missingTerms.length > 0 && termCoverage < 0.6) {
    missingFacets.push(`کلیدواژه‌های پوشش‌داده‌نشده: ${missingTerms.slice(0, 4).join('، ')}`);
  }
  if (specificity < 50) {
    missingFacets.push('شواهد بازیابی‌شده فاقد جزئیات عملیاتی کافی است');
  }

  const overallConfidence = Math.round(
    relevance * 0.35 +
      sufficiency * 0.28 +
      specificity * 0.17 +
      consistency * 0.1 +
      authorization * 0.05 +
      currency * 0.05
  );

  // Decision logic
  if (!allAuthorized || !allCurrent) {
    return {
      decision: 'insufficient',
      overallConfidence: 0,
      criteria: {
        relevance,
        sufficiency,
        consistency,
        authorization,
        currency,
        specificity,
      },
      missingFacets,
      reasonFa: 'شواهد موجود شرایط اعتبار یا مجوز دسترسی را احراز نکردند.',
      evaluatedBy: 'deterministic',
    };
  }

  if (retrieval.conflictDetected) {
    return {
      decision: 'insufficient',
      overallConfidence: Math.min(overallConfidence, 35),
      criteria: {
        relevance,
        sufficiency,
        consistency,
        authorization,
        currency,
        specificity,
      },
      missingFacets,
      reasonFa:
        retrieval.conflictSummaryFa ||
        'بین منابع بازیابی‌شده تعارض عددی یا قانونی مشاهده شد.',
      evaluatedBy: 'deterministic',
    };
  }

  const topHasSemanticMatch = top3.some((m) => m.matchedBy.includes('vector'));

  if (
    topScore < minConfidenceScore ||
    (!topHasSemanticMatch && queryTerms.length >= 2 && termHits === 0) ||
    (termCoverage < 0.28 && (!topHasSemanticMatch || topScore < minConfidenceScore + 15))
  ) {
    return {
      decision: 'insufficient',
      overallConfidence,
      criteria: {
        relevance,
        sufficiency,
        consistency,
        authorization,
        currency,
        specificity,
      },
      missingFacets,
      reasonFa:
        'امتیاز تطبیق یا پوشش کلیدواژه‌های اسناد کمتر از آستانه اطمینان دپارتمان است.',
      evaluatedBy: 'deterministic',
    };
  }

  // Borderline / partial coverage -> Ambiguous
  const strongQaMatch =
    hasQaAuthority &&
    topScore >= Math.max(55, minConfidenceScore + 25) &&
    termCoverage >= 0.4;

  const isAmbiguous =
    (identifiers.length > 0 && idCoverage < 1) ||
    (decomposedSubqueries.length >= 2 && subQueryCoverage < 0.75) ||
    (!strongQaMatch &&
      (termCoverage < 0.55 ||
        sufficiency < 58 ||
        relevance < Math.max(minConfidenceScore + 12, 46)));

  if (isAmbiguous) {
    return {
      decision: 'ambiguous',
      overallConfidence,
      criteria: {
        relevance,
        sufficiency,
        consistency,
        authorization,
        currency,
        specificity,
      },
      missingFacets,
      reasonFa:
        'بخشی از اطلاعات یافت شد اما پوشش کامل تمام اجزای پرسش یا جزئیات کافی احراز نشد؛ نیاز به چرخه بازیابی اصلاحی است.',
      evaluatedBy: 'deterministic',
    };
  }

  return {
    decision: 'relevant',
    overallConfidence,
    criteria: {
      relevance,
      sufficiency,
      consistency,
      authorization,
      currency,
      specificity,
    },
    missingFacets: [],
    reasonFa: 'شواهد بازیابی‌شده از نظر ارتباط، کفایت، انسجام، اعتبار و مجوز برای پاسخ مستند کافی است.',
    evaluatedBy: 'deterministic',
  };
}

function mergeRetrievalResults(
  primary: AdvancedRetrievalResult,
  secondary: AdvancedRetrievalResult,
  limit = 6
): AdvancedRetrievalResult {
  const byKey = new Map<string, RetrievedEvidenceItem>();
  for (const item of [...primary.matches, ...secondary.matches]) {
    const key = `${item.sourceType}:${item.sourceId}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }
  const merged = Array.from(byKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    matches: merged,
    topScore: merged[0]?.score ?? 0,
    conflictDetected: primary.conflictDetected || secondary.conflictDetected,
    conflictSummaryFa:
      secondary.conflictSummaryFa || primary.conflictSummaryFa || null,
    trace: secondary.trace,
  };
}

function parseJsonObjectFromLlm(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runBoundedLlmCragJudge(params: {
  adapter: AiProviderAdapter;
  query: string;
  evidence: RetrievedEvidenceItem[];
  timeoutMs: number;
}): Promise<{
  decision?: CragDecision;
  alternativeQueries: string[];
  reasonFa?: string;
} | null> {
  if (params.evidence.length === 0) return null;

  const evidenceSummary = params.evidence
    .slice(0, 4)
    .map(
      (e, idx) =>
        `[${idx + 1}] (${e.sourceType}, score=${e.score}) ${e.title}\n${e.content.slice(0, 380)}`
    )
    .join('\n---\n');

  try {
    const res = await params.adapter.generateGroundedReply({
      systemInstruction: [
        'You evaluate whether internal organization documents are sufficient to answer a Persian customer question.',
        'Return ONLY valid JSON with shape:',
        '{"decision":"relevant"|"ambiguous"|"insufficient","alternativeQueries":["..."],"reasonFa":"..."}',
        'Do NOT answer the question. Suggest at most 2 concise Persian internal KB search queries if ambiguous or insufficient.',
      ].join('\n'),
      userContent: `Question:\n${params.query}\n\nRetrieved Internal Evidence:\n${evidenceSummary}`,
      timeoutMs: Math.min(params.timeoutMs, 5000),
      maxOutputTokens: 220,
      temperature: 0,
    });

    const parsed = parseJsonObjectFromLlm(res.text);
    if (!parsed) return null;

    const decision =
      parsed.decision === 'relevant' ||
      parsed.decision === 'ambiguous' ||
      parsed.decision === 'insufficient'
        ? parsed.decision
        : undefined;

    const alternativeQueries = Array.isArray(parsed.alternativeQueries)
      ? parsed.alternativeQueries
          .filter((q): q is string => typeof q === 'string' && q.trim().length >= 3)
          .map((q) => q.trim())
          .slice(0, 2)
      : [];

    const reasonFa =
      typeof parsed.reasonFa === 'string' ? parsed.reasonFa.trim().slice(0, 250) : undefined;

    return { decision, alternativeQueries, reasonFa };
  } catch {
    return null;
  }
}

/**
 * Executes Stage 4 Corrective RAG (CRAG):
 * 1. Runs/accepts Stage 3 retrieval strictly inside authorized department documents & Q&A.
 * 2. Evaluates 6 criteria (relevance, sufficiency, consistency, authorization, currency, specificity).
 * 3. For `ambiguous` or `insufficient`, runs bounded corrective retrieval loops ONLY over internal KB
 *    (rewriting queries, decomposing multi-part questions, expanding parent chunks, re-running hybrid+rerank).
 * 4. NEVER falls back to public web search or general LLM world knowledge.
 */
export async function runCorrectiveRagController(
  options: CragControllerOptions
): Promise<CragControllerResult> {
  const startedAt = Date.now();
  const budget = sanitizeBudget(options.budget);
  let modelCallsUsed = 0;

  let currentRetrieval =
    options.initialRetrieval ??
    (await runAdvancedRetrieval({
      departmentId: options.departmentId,
      query: options.query,
      conversationHistory: options.conversationHistory,
      embeddingModel: options.embeddingModel,
      queryEmbedding: options.queryEmbedding,
      embedder: options.embedder,
      adapter: options.adapter,
      forcedStrategy: options.forcedStrategy,
      rerankerMode: options.rerankerMode ?? 'cross_feature',
      minConfidenceScore: budget.minConfidenceScore,
      enableParentExpansion: true,
      finalLimit: 6,
    }));

  const initialRetrievalTrace = currentRetrieval.trace;
  let evaluation = evaluateEvidenceWithCrag({
    query: options.query,
    retrieval: currentRetrieval,
    minConfidenceScore: budget.minConfidenceScore,
  });

  // Optional bounded LLM judge on borderline evaluations
  if (
    budget.enableLlmJudge &&
    options.adapter &&
    modelCallsUsed < budget.maxModelCalls &&
    Date.now() - startedAt < budget.timeoutBudgetMs &&
    currentRetrieval.matches.length > 0 &&
    !currentRetrieval.conflictDetected
  ) {
    modelCallsUsed++;
    const judge = await runBoundedLlmCragJudge({
      adapter: options.adapter,
      query: options.query,
      evidence: currentRetrieval.matches,
      timeoutMs: budget.timeoutBudgetMs - (Date.now() - startedAt),
    });
    if (judge) {
      if (judge.decision && evaluation.decision !== judge.decision) {
        // Safety rule: LLM judge may downgrade relevant->ambiguous/insufficient, or confirm ambiguous
        if (
          judge.decision === 'insufficient' ||
          (evaluation.decision === 'relevant' && judge.decision === 'ambiguous')
        ) {
          evaluation = {
            ...evaluation,
            decision: judge.decision,
            evaluatedBy: 'hybrid_llm',
            reasonFa: judge.reasonFa || evaluation.reasonFa,
          };
        }
      }
    }
  }

  const correctiveSteps: CragStepRecord[] = [];
  let iterationsUsed = 0;
  let budgetExhausted = false;

  // Execute bounded corrective cycles when decision !== 'relevant' and no hard conflict
  while (
    evaluation.decision !== 'relevant' &&
    !currentRetrieval.conflictDetected &&
    iterationsUsed < budget.maxIterations
  ) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= budget.timeoutBudgetMs) {
      budgetExhausted = true;
      break;
    }

    iterationsUsed++;
    const iterStartedAt = Date.now();
    const decisionBefore = evaluation.decision;
    const actionsTaken: CragActionType[] = [];
    const queriesTried: string[] = [];

    // Build corrective internal search queries
    const expandedStr = expandPersianQueryTerms(
      normalizePersianForSearch(options.query)
    );
    const expanded = expandedStr ? [expandedStr] : [];
    if (expanded.length > 0) {
      actionsTaken.push('rewrite_query', 'generate_alternative_queries');
      queriesTried.push(...expanded);
    }

    let llmSuggestedQueries: string[] = [];
    if (
      options.adapter &&
      modelCallsUsed < budget.maxModelCalls &&
      Date.now() - startedAt + 600 < budget.timeoutBudgetMs
    ) {
      modelCallsUsed++;
      const llmHints = await runBoundedLlmCragJudge({
        adapter: options.adapter,
        query: options.query,
        evidence: currentRetrieval.matches,
        timeoutMs: Math.max(500, budget.timeoutBudgetMs - (Date.now() - startedAt)),
      });
      if (llmHints?.alternativeQueries.length) {
        llmSuggestedQueries = llmHints.alternativeQueries;
        actionsTaken.push('generate_alternative_queries');
        queriesTried.push(...llmSuggestedQueries);
      }
    }

    // Iteration 1 favors decomposed/multi_query hybrid + parent expansion + rerank
    // Iteration 2 tries focused alternative queries / iterative pass
    const correctiveQuery =
      iterationsUsed === 1
        ? [options.query, ...expanded.slice(0, 1), ...llmSuggestedQueries.slice(0, 1)]
            .filter(Boolean)
            .join(' ')
        : llmSuggestedQueries[0] || expanded[0] || options.query;

    if (!queriesTried.includes(correctiveQuery)) {
      queriesTried.unshift(correctiveQuery);
    }

    const nextStrategy: RetrievalStrategy =
      iterationsUsed === 1
        ? currentRetrieval.trace.queryTransform.generatedQueries.some(
            (g) => g.type === 'decomposed'
          )
          ? 'decomposed'
          : 'multi_query'
        : 'iterative';

    if (nextStrategy === 'decomposed') actionsTaken.push('decompose_query');
    actionsTaken.push('expand_parent_sections', 'rerun_hybrid_retrieval');

    const canLlmRerank =
      budget.enableLlmRerankOnCorrection &&
      Boolean(options.adapter) &&
      modelCallsUsed < budget.maxModelCalls &&
      Date.now() - startedAt + 600 < budget.timeoutBudgetMs;

    if (canLlmRerank) {
      modelCallsUsed++;
    }
    actionsTaken.push('apply_reranking');

    const retryResult = await runAdvancedRetrieval({
      departmentId: options.departmentId,
      query: correctiveQuery,
      conversationHistory: options.conversationHistory,
      embeddingModel: options.embeddingModel,
      embedder: options.embedder,
      adapter: options.adapter,
      forcedStrategy: nextStrategy,
      rerankerMode: canLlmRerank ? 'llm' : 'cross_feature',
      enableLlmQueryTransform: false,
      enableParentExpansion: true,
      minConfidenceScore: budget.minConfidenceScore,
      candidateLimit: 24,
      finalLimit: 8,
    });

    currentRetrieval = mergeRetrievalResults(currentRetrieval, retryResult, 6);
    evaluation = evaluateEvidenceWithCrag({
      query: options.query,
      retrieval: currentRetrieval,
      minConfidenceScore: budget.minConfidenceScore,
    });

    correctiveSteps.push({
      iteration: iterationsUsed,
      decisionBefore,
      actionsTaken: Array.from(new Set(actionsTaken)),
      queriesTried: Array.from(new Set(queriesTried)).slice(0, 5),
      strategyUsed: nextStrategy,
      candidateCountAfter: currentRetrieval.matches.length,
      topScoreAfter: currentRetrieval.topScore,
      decisionAfter: evaluation.decision,
      durationMs: Date.now() - iterStartedAt,
      reasonFa:
        evaluation.decision === 'relevant'
          ? 'پس از بازنویسی پرسش و بازیابی اصلاحی، شواهد معتبر و کافی یافت شد.'
          : evaluation.reasonFa,
    });

    if (currentRetrieval.conflictDetected) {
      break;
    }
  }

  if (
    evaluation.decision !== 'relevant' &&
    iterationsUsed >= budget.maxIterations
  ) {
    budgetExhausted = true;
  }

  let actionOutcome: CragActionOutcome;
  let clarificationPromptFa: string | null = null;

  if (currentRetrieval.conflictDetected) {
    actionOutcome = 'abstain_conflicting';
    correctiveSteps.push({
      iteration: iterationsUsed,
      decisionBefore: evaluation.decision,
      actionsTaken: ['abstain_and_escalate'],
      queriesTried: [],
      strategyUsed: currentRetrieval.trace.strategy,
      candidateCountAfter: currentRetrieval.matches.length,
      topScoreAfter: currentRetrieval.topScore,
      decisionAfter: 'insufficient',
      durationMs: 0,
      reasonFa: 'تعارض در منابع داخلی شناسایی شد؛ خودداری از پاسخ و ارجاع به اپراتور.',
    });
  } else if (evaluation.decision === 'relevant') {
    actionOutcome = 'proceed_to_generation';
  } else if (
    evaluation.decision === 'ambiguous' &&
    currentRetrieval.matches.length > 0 &&
    currentRetrieval.topScore >= budget.minConfidenceScore + 8 &&
    evaluation.criteria.specificity >= 60 &&
    evaluation.criteria.relevance >= 38
  ) {
    actionOutcome = 'clarify_with_user';
    const topTitles = currentRetrieval.matches
      .slice(0, 2)
      .map((m) => `«${m.title}»`)
      .join(' و ');
    clarificationPromptFa = `موارد مرتبطی در ${topTitles} یافت شد، اما برای ارائه پاسخ دقیق‌تر لطفاً منظور خود را مشخص‌تر بفرمایید یا درخواست خود را به اپراتور دپارتمان ارجاع دهید.`;
    correctiveSteps.push({
      iteration: iterationsUsed,
      decisionBefore: 'ambiguous',
      actionsTaken: ['abstain_and_escalate'],
      queriesTried: [],
      strategyUsed: currentRetrieval.trace.strategy,
      candidateCountAfter: currentRetrieval.matches.length,
      topScoreAfter: currentRetrieval.topScore,
      decisionAfter: 'ambiguous',
      durationMs: 0,
      reasonFa: 'پس از اتمام چرخه اصلاحی، بخشی از موضوع همچنان مبهم است؛ درخواست شفاف‌سازی از کاربر یا ارجاع به اپراتور.',
    });
  } else {
    actionOutcome = 'abstain_insufficient';
    correctiveSteps.push({
      iteration: iterationsUsed,
      decisionBefore: evaluation.decision,
      actionsTaken: ['abstain_and_escalate'],
      queriesTried: [],
      strategyUsed: currentRetrieval.trace.strategy,
      candidateCountAfter: currentRetrieval.matches.length,
      topScoreAfter: currentRetrieval.topScore,
      decisionAfter: 'insufficient',
      durationMs: 0,
      reasonFa: 'شواهد مجاز داخلی پس از بازیابی اصلاحی نیز برای پاسخ قطعی کافی نیست؛ خودداری از پاسخ و پیشنهاد ارجاع به اپراتور.',
    });
  }

  return {
    finalDecision: evaluation.decision,
    actionOutcome,
    evaluation,
    evidence: currentRetrieval.matches,
    topScore: currentRetrieval.topScore,
    conflictDetected: currentRetrieval.conflictDetected,
    conflictSummaryFa: currentRetrieval.conflictSummaryFa,
    correctiveSteps,
    iterationsUsed,
    modelCallsUsed,
    totalLatencyMs: Date.now() - startedAt,
    budgetExhausted,
    clarificationPromptFa,
    initialRetrievalTrace,
    finalRetrievalTrace: currentRetrieval.trace,
  };
}
