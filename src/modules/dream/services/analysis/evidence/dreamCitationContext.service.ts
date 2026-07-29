import type {
  EvidenceGapRuleInput,
} from '../../../../oracle/services/evidence/oracleEvidenceRuleSupport.service';

type RuleSupport = {
  source: any;
  evidence: {
    _id: unknown;
    chunkId: unknown;
    exactQuote?: string;
  };
};

interface DreamContextUpdate {
  context: any;
  changed: boolean;
}

// Adds the rematched rule and excerpt to the same retrieval audit used by Dream responses.
export function addResolvedEvidenceToDreamContext(
  storedContext: any,
  rule: EvidenceGapRuleInput,
  support: RuleSupport,
): DreamContextUpdate {
  const context = storedContext && typeof storedContext === 'object'
    ? storedContext
    : {};
  const componentD = context.componentD && typeof context.componentD === 'object'
    ? context.componentD
    : {};
  const appliedRules = Array.isArray(componentD.appliedRules)
    ? componentD.appliedRules
    : [];
  const evidenceLinks = Array.isArray(componentD.evidenceLinks)
    ? componentD.evidenceLinks
    : [];
  const ruleId = String(rule._id);
  const sourceId = String(support.source?._id || '');
  const chunkId = String(support.evidence?.chunkId || support.evidence?._id || '');
  let changed = false;

  if (!appliedRules.some((item: any) =>
    String(item?.ruleId || item?._id || '') === ruleId)) {
    appliedRules.push(buildAppliedRule(rule));
    changed = true;
  }
  if (!evidenceLinks.some((item: any) =>
    String(item?.ruleId || '') === ruleId
    && String(item?.sourceId || '') === sourceId
    && (item?.chunkIds || []).map(String).includes(chunkId))) {
    evidenceLinks.push(buildEvidenceLink(ruleId, support, sourceId, chunkId));
    changed = true;
  }
  if (!changed) return { context, changed: false };

  context.componentD = {
    ...componentD,
    appliedRules,
    evidenceLinks,
  };
  return { context, changed: true };
}

function buildAppliedRule(rule: EvidenceGapRuleInput): Record<string, unknown> {
  return {
    _id: rule._id,
    ruleId: String(rule._id),
    ruleCode: rule.ruleCode,
    ruleStatement: rule.statement,
    statement: rule.statement,
    subject: rule.subject,
    factor: rule.subject,
    outcome: rule.outcome,
    conditions: rule.conditions || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
    evidenceScore: Number(rule.evidenceScore) || 0,
    supportingSourceCount: Number(rule.supportingSourceCount) || 1,
  };
}

function buildEvidenceLink(
  ruleId: string,
  support: RuleSupport,
  sourceId: string,
  chunkId: string,
): Record<string, unknown> {
  const source = support.source as any;
  const quote = String(support.evidence?.exactQuote || '').trim();
  return {
    ruleId,
    evidenceRole: 'primary_support',
    sourceId,
    sourceTitle: String(source.title || source.metadata?.title || 'Academic source'),
    sourceYear: Number(source.year || source.metadata?.year) || null,
    doi: String(source.doi || source.metadata?.doi || '') || null,
    chunkIds: chunkId ? [chunkId] : [],
    chunkPreview: quote,
  };
}
