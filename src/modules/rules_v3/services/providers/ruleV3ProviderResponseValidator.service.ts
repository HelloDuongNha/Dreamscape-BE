import {
  ProviderCandidate,
  ProviderCandidateEvidence,
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation
} from './ruleV3GenerationProvider.types';
import {
  CLAIM_TYPES,
  EFFECT_POLARITIES,
  EVIDENCE_INTERPRETATIONS,
  EVIDENCE_STANCES,
  LIMIT_CANDIDATES,
  LIMIT_CONDITION_ITEMS,
  LIMIT_EVIDENCE_ITEMS,
  LIMIT_JSON_SIZE,
  LIMIT_LEN_CONDITION,
  LIMIT_LEN_EVIDENCE_ID,
  LIMIT_LEN_LIMITATION,
  LIMIT_LEN_OUTCOME,
  LIMIT_LEN_STATEMENT,
  LIMIT_LEN_SUBJECT,
  LIMIT_LEN_TAG,
  LIMIT_LIMITATION_ITEMS,
  LIMIT_TAG_ITEMS
} from './ruleV3ProviderContract.service';

export function validateProviderResponse(jsonText: string): ProviderCandidate[] {
  if (typeof jsonText !== 'string' || Buffer.byteLength(jsonText, 'utf8') > LIMIT_JSON_SIZE) {
    throw new Error('provider_schema_invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('provider_schema_invalid');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('provider_schema_invalid');
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.candidates)) {
    throw new Error('provider_schema_invalid');
  }

  if (obj.candidates.length > LIMIT_CANDIDATES) {
    throw new Error('provider_schema_invalid');
  }

  const claimTypes = new Set<string>(CLAIM_TYPES);
  const polarities = new Set<string>(EFFECT_POLARITIES);
  const interpretations = new Set<string>(EVIDENCE_INTERPRETATIONS);
  const stances = new Set<string>(EVIDENCE_STANCES);

  const validated: ProviderCandidate[] = [];

  for (const item of obj.candidates) {
    if (!item || typeof item !== 'object') {
      throw new Error('provider_schema_invalid');
    }

    const c = item as Record<string, unknown>;

    if (
      typeof c.statement !== 'string' || c.statement.length > LIMIT_LEN_STATEMENT || !c.statement.trim() ||
      typeof c.claimType !== 'string' || !claimTypes.has(c.claimType) ||
      typeof c.effectPolarity !== 'string' || !polarities.has(c.effectPolarity) ||
      typeof c.evidenceInterpretation !== 'string' || !interpretations.has(c.evidenceInterpretation) ||
      typeof c.subject !== 'string' || c.subject.length > LIMIT_LEN_SUBJECT || !c.subject.trim() ||
      typeof c.outcome !== 'string' || c.outcome.length > LIMIT_LEN_OUTCOME || !c.outcome.trim() ||
      !Array.isArray(c.conditions) || c.conditions.length > LIMIT_CONDITION_ITEMS ||
      !Array.isArray(c.limitations) || c.limitations.length > LIMIT_LIMITATION_ITEMS ||
      !Array.isArray(c.dreamFeatureTags) || c.dreamFeatureTags.length > LIMIT_TAG_ITEMS ||
      !Array.isArray(c.evidence) || c.evidence.length > LIMIT_EVIDENCE_ITEMS
    ) {
      throw new Error('provider_schema_invalid');
    }

    for (const cond of c.conditions) {
      if (typeof cond !== 'string' || cond.length > LIMIT_LEN_CONDITION) {
        throw new Error('provider_schema_invalid');
      }
    }
    for (const lim of c.limitations) {
      if (typeof lim !== 'string' || lim.length > LIMIT_LEN_LIMITATION) {
        throw new Error('provider_schema_invalid');
      }
    }
    for (const tag of c.dreamFeatureTags) {
      if (typeof tag !== 'string' || tag.length > LIMIT_LEN_TAG) {
        throw new Error('provider_schema_invalid');
      }
    }

    const evidenceList: ProviderCandidateEvidence[] = [];
    for (const ev of c.evidence) {
      if (!ev || typeof ev !== 'object') {
        throw new Error('provider_schema_invalid');
      }
      const e = ev as Record<string, unknown>;
      const hasEvidenceId = typeof e.evidenceId === 'string'
        && Boolean(e.evidenceId.trim())
        && e.evidenceId.length <= LIMIT_LEN_EVIDENCE_ID;
      if (!hasEvidenceId || typeof e.stance !== 'string' || !stances.has(e.stance)) {
        throw new Error('provider_schema_invalid');
      }
      evidenceList.push({
        evidenceId: e.evidenceId as string,
        stance: e.stance as 'supports' | 'refutes' | 'limits'
      });
    }

    validated.push({
      statement: c.statement,
      claimType: c.claimType as RuleV3ClaimType,
      effectPolarity: c.effectPolarity as RuleV3EffectPolarity,
      evidenceInterpretation: c.evidenceInterpretation as RuleV3EvidenceInterpretation,
      subject: c.subject,
      outcome: c.outcome,
      conditions: c.conditions as string[],
      limitations: c.limitations as string[],
      dreamFeatureTags: c.dreamFeatureTags as string[],
      evidence: evidenceList
    });
  }

  return validated;
}
