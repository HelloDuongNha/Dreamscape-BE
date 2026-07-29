import {
  expandDreamRetrievalConcepts,
  extractDreamRuleFeatureCategories,
  lexicalOverlap,
} from './ruleV3RetrievalFeatures.service';

export function rankRuleV3Candidates(
  rules: any[],
  dreamText: string,
  dreamEmbedding: number[],
  queryLanguage: 'vi' | 'en' | 'unknown',
) {
  const expandedDreamText = expandDreamRetrievalConcepts(dreamText);
  const contextFeatures = extractDreamRuleFeatureCategories(dreamText);
  return rules.map(rule => scoreRuleCandidate(rule, expandedDreamText, dreamEmbedding, queryLanguage, contextFeatures))
    .filter(item => item.applicable && item.semanticGate >= 0.1)
    .sort((left, right) => right.score - left.score);
}

export function inferRuleQueryLanguage(value: string): 'vi' | 'en' | 'unknown' {
  if (/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/iu.test(value)) return 'vi';
  if (/\b(?:the|and|dream|sleep|memory|fear)\b/iu.test(value)) return 'en';
  return 'unknown';
}

export function classifyRuleApplicationTier(rule: any): 'supported' | 'exploratory' {
  return (Number(rule?.evidenceScore) || 0) >= 60 && (Number(rule?.supportingSourceCount) || 0) >= 2
    ? 'supported'
    : 'exploratory';
}

function scoreRuleCandidate(
  rule: any,
  expandedDreamText: string,
  dreamEmbedding: number[],
  queryLanguage: 'vi' | 'en' | 'unknown',
  contextFeatures: string[],
) {
  const componentParts = compositeSearchParts(rule);
  const lexical = lexicalOverlap(expandedDreamText, [rule.subject, rule.outcome, ...(rule.conditions || []), ...componentParts].join(' '));
  const featureOverlap = lexicalOverlap(expandedDreamText, [...(rule.dreamFeatureTags || []), ...componentParts].join(' '));
  const statementOverlap = lexicalOverlap(expandedDreamText, [rule.statement || '', ...componentParts].join(' '));
  const vector = cosine(dreamEmbedding, rule.embedding || []);
  const semanticGate = Math.max(featureOverlap, lexical, statementOverlap);
  const applicable = conditionIsApplicable(rule, contextFeatures);
  const score = Math.min(1, featureOverlap) * 0.4
    + Math.min(1, lexical) * 0.23
    + Math.min(1, statementOverlap) * 0.12
    + Math.max(0, vector) * 0.15
    + (rule.evidenceScore / 100) * 0.1;
  const crossLanguage = queryLanguage !== 'unknown' && rule.sourceLanguage && rule.sourceLanguage !== queryLanguage;
  return { rule, score, vector, lexical, featureOverlap, statementOverlap, semanticGate, applicable, crossLanguage };
}

function conditionIsApplicable(rule: any, contextFeatures: string[]): boolean {
  const conditionText = (rule.conditions || [])
    .map((item: unknown) => String(item || '').normalize('NFKC').toLocaleLowerCase('vi'))
    .join(' ');
  if (!conditionText) return true;
  if (/\b(?:awakening\s+latency|độ\s+trễ\s+tỉnh\s+giấc)\b/iu.test(conditionText)) {
    return false;
  }
  if (/\b(?:later|late)\s+in\s+the\s+night\b/iu.test(conditionText)) {
    return contextFeatures.includes('late_sleep_period');
  }
  if (/\b(?:different|multiple)\s+time\s+points?\b/iu.test(conditionText)) {
    return contextFeatures.includes('multiple_future_horizons');
  }
  return true;
}

function compositeSearchParts(rule: any): string[] {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  return components.flatMap((component: any) => [
    component.statement,
    component.subject,
    component.outcome,
    ...(component.conditions || []),
    ...(component.dreamFeatureTags || []),
  ].filter(Boolean));
}

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : -1;
}
