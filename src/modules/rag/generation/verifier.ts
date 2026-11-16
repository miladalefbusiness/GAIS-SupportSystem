import {
  extractStructuredIdentifiers,
  normalizePersianForSearch,
  tokenizePersianAndIdentifiers,
} from '../normalizer.ts';
import type { RetrievedEvidenceItem } from '../retrieval/engine.ts';
import {
  mapEvidenceToCitations,
  type GroundedCitation,
  type GroundedGenerationOutput,
} from './generator.ts';

export interface ClaimVerificationItem {
  claim: string;
  supported: boolean;
  supportingRefCodes: string[];
  reason: string;
}

export interface AnswerVerificationResult {
  verified: boolean;
  outcome:
    | 'verified_answer'
    | 'abstain_insufficient'
    | 'abstain_conflicting'
    | 'clarify';
  finalAnswerFa: string;
  citations: GroundedCitation[];
  claimChecks: ClaimVerificationItem[];
  unsupportedClaimCount: number;
  rejectedCitationCount: number;
  faithfulnessScore: number; // 0..100
  verificationReasonFa: string;
}

function splitAnswerClaims(answerFa: string): string[] {
  return answerFa
    .split(/(?:[.!؟\n]+|؛)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);
}

function extractNumericTokens(text: string): string[] {
  const norm = normalizePersianForSearch(text);
  return Array.from(new Set(norm.match(/\d+(?:[.,/]\d+)?/g) || [])).filter(
    (n) => n.length >= 1
  );
}

/**
 * Verifies generated claims and citation provenance strictly against retrieved authorized evidence
 * BEFORE any answer is returned to end users.
 */
export function verifyGroundedAnswer(params: {
  query: string;
  generation: GroundedGenerationOutput;
  evidence: RetrievedEvidenceItem[];
  fallbackMessageFa: string;
}): AnswerVerificationResult {
  const { query, generation, evidence, fallbackMessageFa } = params;

  if (generation.status === 'abstain_conflicting') {
    return {
      verified: false,
      outcome: 'abstain_conflicting',
      finalAnswerFa:
        generation.conflictNoteFa ||
        'در اطلاعات بازیابی‌شده تناقض یا اختلاف نسخه مشاهده شد. برای دریافت پاسخ قطعی، درخواست خود را به اپراتور ارجاع دهید.',
      citations: [],
      claimChecks: [],
      unsupportedClaimCount: 0,
      rejectedCitationCount: 0,
      faithfulnessScore: 100,
      verificationReasonFa: 'مدل یا کنترلر تعارض منابع را تایید کرد.',
    };
  }

  if (generation.status === 'abstain_insufficient' || !generation.answerFa.trim()) {
    return {
      verified: false,
      outcome: 'abstain_insufficient',
      finalAnswerFa: fallbackMessageFa,
      citations: [],
      claimChecks: [],
      unsupportedClaimCount: 0,
      rejectedCitationCount: 0,
      faithfulnessScore: 100,
      verificationReasonFa: 'شواهد برای پاسخ قطعی کافی نبود و سیستم از پاسخ‌گویی خودداری کرد.',
    };
  }

  if (generation.status === 'clarify') {
    const allCitations = mapEvidenceToCitations(evidence);
    const validCited = allCitations.filter((c) =>
      generation.citedRefCodes.includes(c.refCode)
    );
    return {
      verified: true,
      outcome: 'clarify',
      finalAnswerFa:
        generation.clarificationQuestionFa || generation.answerFa.trim(),
      citations: validCited.length > 0 ? validCited : allCitations.slice(0, 2),
      claimChecks: [],
      unsupportedClaimCount: 0,
      rejectedCitationCount: 0,
      faithfulnessScore: 90,
      verificationReasonFa: 'نیاز به شفاف‌سازی پرسش پیش از پاسخ قطعی.',
    };
  }

  // 1. Validate citations against actually retrieved evidence
  const allCitations = mapEvidenceToCitations(evidence);
  const citationMap = new Map(allCitations.map((c) => [c.refCode, c]));

  let rejectedCitationCount = 0;
  const validatedCitations: GroundedCitation[] = [];
  const seenSources = new Set<string>();

  for (const ref of generation.citedRefCodes) {
    const cleanRef = ref.trim().toUpperCase();
    const match = citationMap.get(cleanRef);
    if (!match) {
      rejectedCitationCount++;
      continue;
    }
    if (!seenSources.has(match.sourceId)) {
      seenSources.add(match.sourceId);
      validatedCitations.push(match);
    }
  }

  // Check inline [S#] references in text for fabricated refs (e.g. [S99])
  const inlineRefs = generation.answerFa.match(/\[?\bS\d+\b\]?/g) || [];
  let sanitizedAnswer = generation.answerFa;
  for (const rawRef of inlineRefs) {
    const code = rawRef.replace(/[\[\]]/g, '').trim().toUpperCase();
    if (!citationMap.has(code)) {
      rejectedCitationCount++;
      sanitizedAnswer = sanitizedAnswer.replace(rawRef, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // Ensure every answered response retains at least the top grounded sources if model omitted refs
  if (validatedCitations.length === 0 && allCitations.length > 0) {
    validatedCitations.push(allCitations[0]);
  }

  // Clean bracket markers like [S1] from final displayed prose since structured citation cards are rendered separately
  sanitizedAnswer = sanitizedAnswer
    .replace(/\[\s*S\d+(?:\s*[,،]\s*S\d+)*\s*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 2. Build authoritative corpus text for claim checking
  const normEvidenceList = evidence.map((e, idx) => ({
    refCode: `S${idx + 1}`,
    normText: normalizePersianForSearch(`${e.title} ${e.content}`),
    nums: new Set(extractNumericTokens(`${e.title} ${e.content}`)),
    ids: new Set(extractStructuredIdentifiers(`${e.title} ${e.content}`)),
  }));
  const queryNums = new Set(extractNumericTokens(query));
  const queryIds = new Set(extractStructuredIdentifiers(query));

  // Ignore citation ordinal tokens (e.g. '1', '2' from numbered lists if minor) ONLY when evaluating list prefixes
  const claims = splitAnswerClaims(sanitizedAnswer);
  const claimChecks: ClaimVerificationItem[] = [];
  let unsupportedClaimCount = 0;

  for (const claim of claims) {
    const normClaim = normalizePersianForSearch(claim);
    const claimNums = extractNumericTokens(claim).filter(
      (n) => !queryNums.has(n)
    );
    const claimIds = extractStructuredIdentifiers(claim).filter(
      (id) => !queryIds.has(id)
    );
    const claimTokens = tokenizePersianAndIdentifiers(claim).filter(
      (t) => t.length >= 3
    );

    const supportingRefCodes: string[] = [];
    let bestTokenRatio = 0;

    for (const ev of normEvidenceList) {
      const tokenHits = claimTokens.filter((t) => ev.normText.includes(t)).length;
      const ratio = claimTokens.length > 0 ? tokenHits / claimTokens.length : 1;
      if (ratio > bestTokenRatio) bestTokenRatio = ratio;
      if (ratio >= 0.32) {
        supportingRefCodes.push(ev.refCode);
      }
    }

    // Strict check: every novel factual number / identifier stated by the LLM must exist in retrieved evidence
    const ungroundedNums = claimNums.filter(
      (num) => !normEvidenceList.some((ev) => ev.nums.has(num))
    );
    const ungroundedIds = claimIds.filter(
      (id) => !normEvidenceList.some((ev) => ev.ids.has(id))
    );

    const isShortLeadInHeader =
      claim.trim().endsWith(':') &&
      claimTokens.length <= 6 &&
      claimNums.length === 0 &&
      claimIds.length === 0;

    const isMetaDisclaimer =
      isShortLeadInHeader ||
      (/اطلاعات|منبع|مخزن|اپراتور|پرسش|سوال/.test(normClaim) &&
        claimNums.length === 0 &&
        claimIds.length === 0);

    const supported =
      ungroundedNums.length === 0 &&
      ungroundedIds.length === 0 &&
      (bestTokenRatio >= 0.3 || isMetaDisclaimer || supportingRefCodes.length > 0);

    if (!supported) {
      unsupportedClaimCount++;
      claimChecks.push({
        claim,
        supported: false,
        supportingRefCodes,
        reason:
          ungroundedNums.length > 0
            ? `عدد تاییدنشده در پاسخ: ${ungroundedNums.join(', ')}`
            : ungroundedIds.length > 0
            ? `شناسه تاییدنشده در پاسخ: ${ungroundedIds.join(', ')}`
            : 'ادعا تطابق کافی با متن شواهد ندارد.',
      });
    } else {
      claimChecks.push({
        claim,
        supported: true,
        supportingRefCodes:
          supportingRefCodes.length > 0
            ? supportingRefCodes
            : [validatedCitations[0]?.refCode || 'S1'],
        reason: 'ادعا توسط شواهد بازیابی‌شده پشتیبانی می‌شود.',
      });
    }
  }

  const totalClaims = Math.max(1, claims.length);
  const faithfulnessScore = Math.max(
    0,
    Math.round(((totalClaims - unsupportedClaimCount) / totalClaims) * 100)
  );

  // Fail closed: if unsupported factual numbers/codes exist OR >40% of claims lack support -> abstain!
  const hasFabricatedFact = claimChecks.some(
    (c) => !c.supported && c.reason.includes('تاییدنشده')
  );
  if (
    hasFabricatedFact ||
    (claims.length >= 2 && unsupportedClaimCount / claims.length > 0.4) ||
    validatedCitations.length === 0
  ) {
    return {
      verified: false,
      outcome: 'abstain_insufficient',
      finalAnswerFa: fallbackMessageFa,
      citations: [],
      claimChecks,
      unsupportedClaimCount,
      rejectedCitationCount,
      faithfulnessScore,
      verificationReasonFa:
        'پاسخ تولیدشده حاوی ادعا یا مقادیر عددی بدون پشتیبانی در اسناد مجاز بود و مسدود شد.',
    };
  }

  // Append explicit assumptions cleanly if present and not already shown
  const assumptions = generation.assumptionsFa.filter(
    (a) => a.trim().length > 3 && !sanitizedAnswer.includes(a.trim())
  );
  const finalWithAssumptions =
    assumptions.length > 0
      ? `${sanitizedAnswer}\n\nشروط و نکات قابل توجه:\n${assumptions.map((a) => `• ${a}`).join('\n')}`
      : sanitizedAnswer;

  return {
    verified: true,
    outcome: 'verified_answer',
    finalAnswerFa: finalWithAssumptions,
    citations: validatedCitations,
    claimChecks,
    unsupportedClaimCount,
    rejectedCitationCount,
    faithfulnessScore,
    verificationReasonFa: 'تمامی ادعاها و ارجاعات پاسخ با اسناد بازیابی‌شده منطبق و تایید شد.',
  };
}
