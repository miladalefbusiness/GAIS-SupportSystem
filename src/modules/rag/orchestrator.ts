import type { AiProviderAdapter } from '../ai/provider.ts';
import type { InternalAiProviderRuntimeConfig } from '../ai/settings.ts';
import {
  runCorrectiveRagController,
  type CragControllerResult,
} from './crag/controller.ts';
import {
  generateGroundedAnswer,
  mapEvidenceToCitations,
  type GroundedCitation,
  type GroundedGenerationOutput,
} from './generation/generator.ts';
import {
  verifyGroundedAnswer,
  type AnswerVerificationResult,
} from './generation/verifier.ts';

export const CONFLICT_ABSTAIN_MESSAGE_FA =
  'در اسناد مخزن دانش درباره این موضوع اطلاعات متفاوت یا در حال به‌روزرسانی مشاهده شد. برای اطمینان از دریافت آخرین مصوبه رسمی، لطفاً درخواست خود را به اپراتور دپارتمان ارجاع دهید.';

export interface RagOrchestratorTraceSummary {
  strategy: string;
  strategyReasonFa: string;
  generatedQueries: Array<{ query: string; type: string; reason: string }>;
  rerankMethod: string;
  parentExpandedCount: number;
  cragDecision: CragControllerResult['finalDecision'];
  cragConfidence: number;
  cragCriteria: CragControllerResult['evaluation']['criteria'];
  cragReasonFa: string;
  correctiveIterationsUsed: number;
  correctiveModelCallsUsed: number;
  correctiveSteps: CragControllerResult['correctiveSteps'];
  faithfulnessScore: number | null;
  unsupportedClaimCount: number;
  rejectedCitationCount: number;
  indirectInjectionDetectedInDocs: boolean;
  verificationReasonFa: string | null;
  totalLatencyMs: number;
}

export interface RagPipelineResult {
  outcome:
    | 'verified_answer'
    | 'abstain_insufficient'
    | 'abstain_conflicting'
    | 'clarify';
  answerFa: string;
  abstained: boolean;
  escalationRecommended: boolean;
  citations: GroundedCitation[];
  topScore: number;
  crag: CragControllerResult;
  generation: GroundedGenerationOutput | null;
  verification: AnswerVerificationResult | null;
  traceSummary: RagOrchestratorTraceSummary;
  totalLatencyMs: number;
}

export interface RunRagPipelineParams {
  departmentId: string;
  departmentNameFa: string;
  query: string;
  conversationHistory?: Array<{ senderRole: string; content: string }>;
  runtimeConfig: InternalAiProviderRuntimeConfig;
  minConfidenceScore: number;
  autoOfferEscalation: boolean;
  fallbackMessageFa: string;
  adapter: AiProviderAdapter;
}

/**
 * Unifies Stages 3, 4 & 5 into a single reusable Helpdesk RAG Engine pipeline:
 * Pre-LLM Auth -> Adaptive Hybrid RRF + Rerank + Parent-Child -> CRAG -> Grounded Gen -> Claim/Citation Verifier.
 * Provider/network errors during final generation are intentionally thrown so callers can persist provider_error & handoff safely.
 */
export async function runEnterpriseRagPipeline(
  params: RunRagPipelineParams
): Promise<RagPipelineResult> {
  const startedAt = Date.now();
  const { runtimeConfig, adapter } = params;

  const crag = await runCorrectiveRagController({
    departmentId: params.departmentId,
    query: params.query,
    conversationHistory: params.conversationHistory,
    embeddingModel: runtimeConfig.embeddingModel,
    embedder: runtimeConfig.embeddingModel
      ? async (text: string) => {
          try {
            return await adapter.generateEmbedding(text);
          } catch {
            return null;
          }
        }
      : null,
    adapter,
    rerankerMode: runtimeConfig.rerankerMode ?? 'cross_feature',
    budget: {
      maxIterations: runtimeConfig.cragMaxIterations ?? 2,
      maxModelCalls: runtimeConfig.cragMaxModelCalls ?? 2,
      minConfidenceScore: params.minConfidenceScore,
      enableLlmJudge: runtimeConfig.cragEnableLlmJudge ?? false,
      enableLlmRerankOnCorrection: runtimeConfig.rerankerMode === 'llm',
    },
  });

  const baseTrace = (
    verification: AnswerVerificationResult | null,
    generation: GroundedGenerationOutput | null
  ): RagOrchestratorTraceSummary => ({
    strategy: crag.finalRetrievalTrace.strategy,
    strategyReasonFa: crag.finalRetrievalTrace.strategyReasonFa,
    generatedQueries: crag.finalRetrievalTrace.queryTransform.generatedQueries,
    rerankMethod: crag.finalRetrievalTrace.rerankMethod,
    parentExpandedCount: crag.finalRetrievalTrace.parentExpandedCount,
    cragDecision: crag.finalDecision,
    cragConfidence: crag.evaluation.overallConfidence,
    cragCriteria: crag.evaluation.criteria,
    cragReasonFa: crag.evaluation.reasonFa,
    correctiveIterationsUsed: crag.iterationsUsed,
    correctiveModelCallsUsed: crag.modelCallsUsed,
    correctiveSteps: crag.correctiveSteps,
    faithfulnessScore: verification ? verification.faithfulnessScore : null,
    unsupportedClaimCount: verification ? verification.unsupportedClaimCount : 0,
    rejectedCitationCount: verification ? verification.rejectedCitationCount : 0,
    indirectInjectionDetectedInDocs: Boolean(
      generation?.indirectInjectionDetectedInDocs
    ),
    verificationReasonFa: verification ? verification.verificationReasonFa : null,
    totalLatencyMs: Date.now() - startedAt,
  });

  if (crag.actionOutcome === 'abstain_conflicting') {
    return {
      outcome: 'abstain_conflicting',
      answerFa: CONFLICT_ABSTAIN_MESSAGE_FA,
      abstained: true,
      escalationRecommended: true,
      citations: [],
      topScore: crag.topScore,
      crag,
      generation: null,
      verification: null,
      traceSummary: baseTrace(null, null),
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  if (crag.actionOutcome === 'abstain_insufficient') {
    return {
      outcome: 'abstain_insufficient',
      answerFa: params.fallbackMessageFa,
      abstained: true,
      escalationRecommended: params.autoOfferEscalation,
      citations: [],
      topScore: crag.topScore,
      crag,
      generation: null,
      verification: null,
      traceSummary: baseTrace(null, null),
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  if (crag.actionOutcome === 'clarify_with_user' && crag.clarificationPromptFa) {
    const clarifyCitations = mapEvidenceToCitations(crag.evidence.slice(0, 2));
    return {
      outcome: 'clarify',
      answerFa: crag.clarificationPromptFa,
      abstained: false,
      escalationRecommended: params.autoOfferEscalation,
      citations: clarifyCitations,
      topScore: crag.topScore,
      crag,
      generation: null,
      verification: null,
      traceSummary: baseTrace(null, null),
      totalLatencyMs: Date.now() - startedAt,
    };
  }

  // Stage 5: Grounded Answer Generation + Verification
  const generation = await generateGroundedAnswer({
    departmentNameFa: params.departmentNameFa,
    query: params.query,
    evidence: crag.evidence,
    adapter,
    timeoutMs: runtimeConfig.timeoutMs,
    maxOutputTokens: runtimeConfig.maxOutputTokens,
    temperature: runtimeConfig.temperature,
    conversationHistory: params.conversationHistory,
  });

  const verification = verifyGroundedAnswer({
    query: params.query,
    generation,
    evidence: crag.evidence,
    fallbackMessageFa: params.fallbackMessageFa,
  });

  const isAbstained =
    verification.outcome === 'abstain_insufficient' ||
    verification.outcome === 'abstain_conflicting';

  const escalationRecommended =
    verification.outcome === 'abstain_conflicting'
      ? true
      : verification.outcome === 'abstain_insufficient' ||
        verification.outcome === 'clarify'
      ? params.autoOfferEscalation
      : false;

  return {
    outcome: verification.outcome,
    answerFa:
      verification.outcome === 'abstain_conflicting'
        ? CONFLICT_ABSTAIN_MESSAGE_FA
        : verification.finalAnswerFa,
    abstained: isAbstained,
    escalationRecommended,
    citations: verification.citations,
    topScore: crag.topScore,
    crag,
    generation,
    verification,
    traceSummary: baseTrace(verification, generation),
    totalLatencyMs: Date.now() - startedAt,
  };
}
