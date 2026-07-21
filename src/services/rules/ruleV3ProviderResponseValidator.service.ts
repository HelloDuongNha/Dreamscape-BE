import {
  ProviderCandidate,
  ProviderCandidateEvidence,
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation
} from './ruleV3GenerationProvider.types';

// Centrally defined and exported validation constants to prevent drift
export const LIMIT_JSON_SIZE = 100_000;
export const LIMIT_CANDIDATES = 3;
export const LIMIT_EVIDENCE_ITEMS = 5;
export const LIMIT_CONDITION_ITEMS = 10;
export const LIMIT_LIMITATION_ITEMS = 10;
export const LIMIT_TAG_ITEMS = 15;

export const LIMIT_LEN_STATEMENT = 5000;
export const LIMIT_LEN_SUBJECT = 500;
export const LIMIT_LEN_OUTCOME = 500;
export const LIMIT_LEN_CONDITION = 500;
export const LIMIT_LEN_LIMITATION = 500;
export const LIMIT_LEN_TAG = 100;
export const LIMIT_LEN_EVIDENCE_ID = 100;
const LIMIT_LEN_LEGACY_PROPOSED_QUOTE = 1000;
const LIMIT_LEN_LEGACY_CHUNK_ID = 100;

export const OLLAMA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      maxItems: LIMIT_CANDIDATES,
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          claimType: {
            type: 'string',
            enum: [
              'association',
              'prediction',
              'intervention_effect',
              'moderation',
              'mediation',
              'qualitative_theme',
              'theoretical_proposition',
              'review_synthesis',
              'null_finding'
            ]
          },
          effectPolarity: {
            type: 'string',
            enum: ['positive', 'negative', 'mixed', 'neutral', 'unknown']
          },
          evidenceInterpretation: {
            type: 'string',
            enum: ['causal', 'associational', 'predictive', 'descriptive', 'interpretive', 'not_applicable']
          },
          subject: { type: 'string' },
          outcome: { type: 'string' },
          conditions: {
            type: 'array',
            items: { type: 'string' }
          },
          limitations: {
            type: 'array',
            items: { type: 'string' }
          },
          dreamFeatureTags: {
            type: 'array',
            items: { type: 'string' }
          },
          evidence: {
            type: 'array',
            maxItems: LIMIT_EVIDENCE_ITEMS,
            items: {
              type: 'object',
              properties: {
                evidenceId: { type: 'string' },
                stance: {
                  type: 'string',
                  enum: ['supports', 'refutes', 'limits']
                }
              },
              required: ['evidenceId', 'stance']
            }
          }
        },
        required: [
          'statement',
          'claimType',
          'effectPolarity',
          'evidenceInterpretation',
          'subject',
          'outcome',
          'conditions',
          'limitations',
          'dreamFeatureTags',
          'evidence'
        ]
      }
    }
  },
  required: ['candidates']
};

export const GEMINI_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    candidates: {
      type: 'ARRAY',
      description: 'List of rule candidates extracted (maximum ' + LIMIT_CANDIDATES + ' candidates)',
      maxItems: LIMIT_CANDIDATES,
      items: {
        type: 'OBJECT',
        properties: {
          statement: { type: 'STRING' },
          claimType: {
            type: 'STRING',
            enum: [
              'association',
              'prediction',
              'intervention_effect',
              'moderation',
              'mediation',
              'qualitative_theme',
              'theoretical_proposition',
              'review_synthesis',
              'null_finding'
            ]
          },
          effectPolarity: {
            type: 'STRING',
            enum: ['positive', 'negative', 'mixed', 'neutral', 'unknown']
          },
          evidenceInterpretation: {
            type: 'STRING',
            enum: ['causal', 'associational', 'predictive', 'descriptive', 'interpretive', 'not_applicable']
          },
          subject: { type: 'STRING' },
          outcome: { type: 'STRING' },
          conditions: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          limitations: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          dreamFeatureTags: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          evidence: {
            type: 'ARRAY',
            description: 'List of proposed evidence items (maximum ' + LIMIT_EVIDENCE_ITEMS + ' items)',
            maxItems: LIMIT_EVIDENCE_ITEMS,
            items: {
              type: 'OBJECT',
              properties: {
                evidenceId: { type: 'STRING' },
                stance: {
                  type: 'STRING',
                  enum: ['supports', 'refutes', 'limits']
                }
              },
              required: ['evidenceId', 'stance']
            }
          }
        },
        required: [
          'statement',
          'claimType',
          'effectPolarity',
          'evidenceInterpretation',
          'subject',
          'outcome',
          'conditions',
          'limitations',
          'dreamFeatureTags',
          'evidence'
        ]
      }
    }
  },
  required: ['candidates']
};

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

  const claimTypes = new Set<string>([
    'association',
    'prediction',
    'intervention_effect',
    'moderation',
    'mediation',
    'qualitative_theme',
    'theoretical_proposition',
    'review_synthesis',
    'null_finding'
  ]);
  const polarities = new Set<string>(['positive', 'negative', 'mixed', 'neutral', 'unknown']);
  const interpretations = new Set<string>(['causal', 'associational', 'predictive', 'descriptive', 'interpretive', 'not_applicable']);
  const stances = new Set<string>(['supports', 'refutes', 'limits']);

  const validated: ProviderCandidate[] = [];

  for (const item of obj.candidates) {
    if (!item || typeof item !== 'object') {
      throw new Error('provider_schema_invalid');
    }

    const c = item as Record<string, unknown>;

    // Type checks
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

    // Validate conditions, limitations, dreamFeatureTags containing strings only
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

    // Validate evidence fields
    const evidenceList: ProviderCandidateEvidence[] = [];
    for (const ev of c.evidence) {
      if (!ev || typeof ev !== 'object') {
        throw new Error('provider_schema_invalid');
      }
      const e = ev as Record<string, unknown>;
      const hasEvidenceId = typeof e.evidenceId === 'string'
        && Boolean(e.evidenceId.trim())
        && e.evidenceId.length <= LIMIT_LEN_EVIDENCE_ID;
      const hasLegacyExactQuote = typeof e.chunkId === 'string'
        && Boolean(e.chunkId.trim())
        && e.chunkId.length <= LIMIT_LEN_LEGACY_CHUNK_ID
        && typeof e.proposedQuote === 'string'
        && Boolean(e.proposedQuote.trim())
        && e.proposedQuote.length <= LIMIT_LEN_LEGACY_PROPOSED_QUOTE;
      if ((!hasEvidenceId && !hasLegacyExactQuote) || typeof e.stance !== 'string' || !stances.has(e.stance)) {
        throw new Error('provider_schema_invalid');
      }
      evidenceList.push(hasEvidenceId ? {
        evidenceId: e.evidenceId as string,
        stance: e.stance as 'supports' | 'refutes' | 'limits'
      } : {
        chunkId: e.chunkId as string,
        proposedQuote: e.proposedQuote as string,
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
