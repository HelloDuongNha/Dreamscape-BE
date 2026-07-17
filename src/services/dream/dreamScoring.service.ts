/**
 * Scoring factor interface.
 */
export interface IScoringFactor {
  source: 'A' | 'B' | 'C' | 'D';
  factor: string;
  impact: number;
  reason: string;
}

/**
 * Score breakdown structure matching project spec.
 */
export interface IScoreBreakdown {
  finalScore: number;
  label: string;
  explanation: string;
  components: {
    ScoreA: { score: number; weight: number; reason: string };
    ScoreB: { score: number; weight: number; reason: string };
    ScoreC: { score: number; weight: number; reason: string };
    ScoreD: { score: number; weight: number; reason: string };
  };
  factors: IScoringFactor[];
}

/**
 * Calculates Component A (Dictionary Symbols) score.
 * Uses only promptSymbols selected for LLM injection.
 */
export function calculateComponentAScore(symbols: any[]): { score: number; reason: string; factors: IScoringFactor[] } {
  if (!symbols || symbols.length === 0) {
    return {
      score: 50,
      reason: 'No RAG symbols identified in the dream narrative.',
      factors: [
        {
          source: 'A',
          factor: 'no_symbols_found',
          impact: 0,
          reason: 'No RAG symbols identified in the dream narrative.'
        }
      ]
    };
  }

  let sumWeight = 0;
  let sumWeightedValence = 0;
  const factors: IScoringFactor[] = [];

  for (const sym of symbols) {
    const v_i = sym.symbolValence;
    const adjustedScore_i = sym.adjustedScore;

    let methodWeight_i = 0.60;
    if (sym.retrievalMethods.includes('exact_match')) {
      methodWeight_i = 1.0;
    } else if (sym.retrievalMethods.includes('phrase_vector')) {
      methodWeight_i = 0.85;
    }

    const confidenceWeight_i = sym.lowConfidence ? 0.50 : 1.0;
    const weight_i = adjustedScore_i * methodWeight_i * confidenceWeight_i;

    sumWeight += weight_i;
    sumWeightedValence += v_i * weight_i;

    factors.push({
      source: 'A',
      factor: sym.symbol,
      impact: v_i,
      reason: `Symbol "${sym.symbol}" with valence ${v_i} (RAG adjusted score: ${adjustedScore_i.toFixed(2)}, retrieval method: ${sym.retrievalMethods.join(', ')})`
    });
  }

  if (sumWeight > 0) {
    const WeightedSymbolValence = sumWeightedValence / sumWeight;
    const score = ((WeightedSymbolValence + 10) / 20) * 100;
    return {
      score: Math.min(100, Math.max(0, score)),
      reason: `Weighted average of ${symbols.length} RAG-retrieved symbol(s) based on symbol valence and retrieval confidence.`,
      factors
    };
  }

  return {
    score: 50,
    reason: 'Zero sum weight for retrieved symbols.',
    factors: [
      {
        source: 'A',
        factor: 'zero_sum_weight',
        impact: 0,
        reason: 'Zero sum weight for retrieved symbols.'
      }
    ]
  };
}

/**
 * Calculates Component D (Knowledge Rules) score using stored DB metadata.
 */
export function calculateComponentDScore(appliedRules: any[]): { score: number; reason: string; factors: IScoringFactor[] } {
  const factors: IScoringFactor[] = [];
  const score = 50;
  const reason = 'No active sleep context or environmental rules affected the score.';

  factors.push({
    source: 'D',
    factor: 'no_rules_applied',
    impact: 0,
    reason: 'No active sleep context or environmental rules affected the score.'
  });

  return {
    score,
    reason,
    factors
  };
}

/**
 * Calculates Component C score. Defaults to 50 with personal history missing.
 */
export function calculateComponentCScore(): { score: number; reason: string; factors: IScoringFactor[] } {
  return {
    score: 50,
    reason: 'no_personal_history_available',
    factors: [
      {
        source: 'C',
        factor: 'no_personal_history_available',
        impact: 0,
        reason: 'No personal history available.'
      }
    ]
  };
}

/**
 * Map valence score to Vietnamese / English human-readable labels.
 */
function getValenceLabel(score: number): string {
  if (score <= 20) return 'Very negative';
  if (score <= 40) return 'Negative';
  if (score <= 60) return 'Mixed';
  if (score <= 80) return 'Positive';
  return 'Very positive';
}

/**
 * Blends Score A (50%), Score B (10%), Score C (15%), and Score D (25%) to output a final rounded dream score.
 */
export function calculateDreamScore(
  components: { scoreA: number; scoreB: number; scoreC: number; scoreD: number },
  reasons: { reasonA: string; reasonB: string; reasonC: string; reasonD: string },
  factors: IScoringFactor[]
): IScoreBreakdown {
  const finalScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        0.50 * components.scoreA +
        0.10 * components.scoreB +
        0.15 * components.scoreC +
        0.25 * components.scoreD
      )
    )
  );

  const label = getValenceLabel(finalScore);
  const explanation = `Chỉ số cảm xúc giấc mơ được tính toán từ các thành phần: Biểu tượng giải mã (Score A: ${components.scoreA.toFixed(0)}, trọng số 50%), hồ sơ tâm lý người dùng (Score B: ${components.scoreB.toFixed(0)}, trọng số 10%), lịch sử cá nhân (Score C: ${components.scoreC.toFixed(0)}, trọng số 15%), và bối cảnh sinh lý/môi trường giấc ngủ (Score D: ${components.scoreD.toFixed(0)}, trọng số 25%).`;

  return {
    finalScore,
    label,
    explanation,
    components: {
      ScoreA: { score: components.scoreA, weight: 0.50, reason: reasons.reasonA },
      ScoreB: { score: components.scoreB, weight: 0.10, reason: reasons.reasonB },
      ScoreC: { score: components.scoreC, weight: 0.15, reason: reasons.reasonC },
      ScoreD: { score: components.scoreD, weight: 0.25, reason: reasons.reasonD }
    },
    factors
  };
}
