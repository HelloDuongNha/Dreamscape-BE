export const LIMIT_JSON_SIZE = 100_000;
export const LIMIT_CANDIDATES = 3;
export const LIMIT_EVIDENCE_ITEMS = 5;
export const LIMIT_CONDITION_ITEMS = 20;
export const LIMIT_LIMITATION_ITEMS = 20;
export const LIMIT_TAG_ITEMS = 20;

export const LIMIT_LEN_STATEMENT = 1000;
export const LIMIT_LEN_SUBJECT = 200;
export const LIMIT_LEN_OUTCOME = 200;
export const LIMIT_LEN_CONDITION = 100;
export const LIMIT_LEN_LIMITATION = 100;
export const LIMIT_LEN_TAG = 100;
export const LIMIT_LEN_EVIDENCE_ID = 100;

export const CLAIM_TYPES = [
  'association',
  'prediction',
  'intervention_effect',
  'moderation',
  'mediation',
  'qualitative_theme',
  'theoretical_proposition',
  'review_synthesis',
  'null_finding'
] as const;

export const EFFECT_POLARITIES = [
  'positive',
  'negative',
  'mixed',
  'neutral',
  'unknown'
] as const;

export const EVIDENCE_INTERPRETATIONS = [
  'causal',
  'associational',
  'predictive',
  'descriptive',
  'interpretive',
  'not_applicable'
] as const;

export const EVIDENCE_STANCES = ['supports', 'refutes', 'limits'] as const;

type SchemaDialect = {
  object: string;
  array: string;
  string: string;
  includeDescriptions: boolean;
};

function buildProviderSchema(dialect: SchemaDialect) {
  const evidence = {
    type: dialect.array,
    ...(dialect.includeDescriptions
      ? { description: `List of proposed evidence items (maximum ${LIMIT_EVIDENCE_ITEMS} items)` }
      : {}),
    maxItems: LIMIT_EVIDENCE_ITEMS,
    items: {
      type: dialect.object,
      properties: {
        evidenceId: { type: dialect.string },
        stance: { type: dialect.string, enum: [...EVIDENCE_STANCES] }
      },
      required: ['evidenceId', 'stance']
    }
  };

  return {
    type: dialect.object,
    properties: {
      candidates: {
        type: dialect.array,
        ...(dialect.includeDescriptions
          ? { description: `List of rule candidates extracted (maximum ${LIMIT_CANDIDATES} candidates)` }
          : {}),
        maxItems: LIMIT_CANDIDATES,
        items: {
          type: dialect.object,
          properties: {
            statement: { type: dialect.string, maxLength: LIMIT_LEN_STATEMENT },
            claimType: { type: dialect.string, enum: [...CLAIM_TYPES] },
            effectPolarity: { type: dialect.string, enum: [...EFFECT_POLARITIES] },
            evidenceInterpretation: {
              type: dialect.string,
              enum: [...EVIDENCE_INTERPRETATIONS]
            },
            subject: { type: dialect.string, maxLength: LIMIT_LEN_SUBJECT },
            outcome: { type: dialect.string, maxLength: LIMIT_LEN_OUTCOME },
            conditions: {
              type: dialect.array,
              maxItems: LIMIT_CONDITION_ITEMS,
              items: { type: dialect.string, maxLength: LIMIT_LEN_CONDITION }
            },
            limitations: {
              type: dialect.array,
              maxItems: LIMIT_LIMITATION_ITEMS,
              items: { type: dialect.string, maxLength: LIMIT_LEN_LIMITATION }
            },
            dreamFeatureTags: {
              type: dialect.array,
              maxItems: LIMIT_TAG_ITEMS,
              items: { type: dialect.string, maxLength: LIMIT_LEN_TAG }
            },
            evidence
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
}

export const OLLAMA_JSON_SCHEMA = buildProviderSchema({
  object: 'object',
  array: 'array',
  string: 'string',
  includeDescriptions: false
});

export const GEMINI_JSON_SCHEMA = buildProviderSchema({
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  includeDescriptions: true
});
