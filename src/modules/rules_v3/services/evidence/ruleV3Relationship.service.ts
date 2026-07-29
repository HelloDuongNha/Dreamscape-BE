import {
  hasMorphologicalScopeTension,
  meaningfulSemanticSimilarity,
  semanticSimilarity,
} from './ruleV3SemanticSimilarity.service';

export type RuleV3Relationship =
  | 'equivalent'
  | 'overlapping'
  | 'complementary'
  | 'scope_tension'
  | 'shared_context'
  | 'contradictory'
  | 'reverse_direction'
  | 'unrelated';

export interface RuleV3RelationInput {
  subject: string;
  outcome: string;
  claimType: string;
  effectPolarity: string;
  conditions?: string[];
  statement?: string;
}

export interface RuleV3RelationshipContext {
  sharedEvidenceContext?: boolean;
  sameQuestionKind?: boolean;
  sameSourceDocument?: boolean;
}

export type RuleV3RelationshipSignal =
  | 'same_source_document'
  | 'same_canonical_paragraph'
  | 'related_subject'
  | 'related_outcome'
  | 'similar_statement'
  | 'same_question_kind';

export type RuleV3MergeReason =
  | 'same_canonical_paragraph'
  | 'equivalent_subject_and_outcome'
  | 'same_meaningful_subject'
  | 'same_meaningful_outcome'
  | 'same_statement_semantics'
  | 'same_question_and_semantics';

export interface RuleV3MergeAssessment {
  canMerge: boolean;
  reasons: RuleV3MergeReason[];
  subjectSimilarity: number;
  outcomeSimilarity: number;
  statementSimilarity: number;
  signals: RuleV3RelationshipSignal[];
}

export function assessRuleV3MergeCompatibility(
  a: RuleV3RelationInput,
  b: RuleV3RelationInput,
  context: RuleV3RelationshipContext = {},
): RuleV3MergeAssessment {
  const subjectSimilarity = meaningfulSemanticSimilarity(a.subject, b.subject);
  const outcomeSimilarity = meaningfulSemanticSimilarity(a.outcome, b.outcome);
  const statementSimilarity = semanticSimilarity(a.statement || '', b.statement || '');
  const rawSubjectSimilarity = semanticSimilarity(a.subject, b.subject);
  const rawOutcomeSimilarity = semanticSimilarity(a.outcome, b.outcome);
  const compatibleDirection = !oppositePolarity(a.effectPolarity, b.effectPolarity)
    && (a.claimType === 'null_finding') === (b.claimType === 'null_finding');
  const reasons: RuleV3MergeReason[] = [];
  const signals: RuleV3RelationshipSignal[] = [];
  if (context.sameSourceDocument) signals.push('same_source_document');
  if (context.sharedEvidenceContext) signals.push('same_canonical_paragraph');
  if (subjectSimilarity >= 0.3 || rawSubjectSimilarity >= 0.45) signals.push('related_subject');
  if (outcomeSimilarity >= 0.3 || rawOutcomeSimilarity >= 0.45) signals.push('related_outcome');
  if (statementSimilarity >= 0.25) signals.push('similar_statement');
  if (context.sameQuestionKind) signals.push('same_question_kind');
  if (context.sharedEvidenceContext && compatibleDirection) reasons.push('same_canonical_paragraph');
  if (compatibleDirection && rawSubjectSimilarity >= 0.65 && rawOutcomeSimilarity >= 0.65) {
    reasons.push('equivalent_subject_and_outcome');
  }
  if (compatibleDirection && subjectSimilarity >= 0.72 && (outcomeSimilarity >= 0.15 || statementSimilarity >= 0.25)) {
    reasons.push('same_meaningful_subject');
  }
  if (compatibleDirection && outcomeSimilarity >= 0.72 && (subjectSimilarity >= 0.15 || statementSimilarity >= 0.25)) {
    reasons.push('same_meaningful_outcome');
  }
  if (compatibleDirection && statementSimilarity >= 0.55
    && subjectSimilarity >= 0.3 && outcomeSimilarity >= 0.3) {
    reasons.push('same_statement_semantics');
  }
  if (compatibleDirection && context.sameQuestionKind && statementSimilarity >= 0.45) {
    reasons.push('same_question_and_semantics');
  }
  return {
    canMerge: reasons.length > 0,
    reasons: [...new Set(reasons)],
    subjectSimilarity,
    outcomeSimilarity,
    statementSimilarity,
    signals: [...new Set(signals)],
  };
}

// Chỉ gộp điểm khi mọi mệnh đề thật sự cùng chủ thể và cùng kết quả.
export function areRuleV3ComponentsEvidenceEquivalent(components: RuleV3RelationInput[]): boolean {
  if (components.length < 2) return false;
  const [anchor, ...rest] = components;
  return rest.every(component =>
    assessRuleV3MergeCompatibility(anchor, component).reasons.includes('equivalent_subject_and_outcome'));
}

function conditionCompatibility(a: string[] = [], b: string[] = []): number {
  if (a.length === 0 || b.length === 0) return 1;
  return semanticSimilarity(a.join(' '), b.join(' '));
}

function oppositePolarity(a: string, b: string): boolean {
  return (a === 'positive' && b === 'negative') || (a === 'negative' && b === 'positive');
}

export function classifyRuleV3Relationship(
  a: RuleV3RelationInput,
  b: RuleV3RelationInput,
  context: RuleV3RelationshipContext = {},
): RuleV3Relationship {
  const sameSubject = semanticSimilarity(a.subject, b.subject);
  const sameOutcome = semanticSimilarity(a.outcome, b.outcome);
  const reversedSubject = semanticSimilarity(a.subject, b.outcome);
  const reversedOutcome = semanticSimilarity(a.outcome, b.subject);
  const sameDirection = sameSubject >= 0.65 && sameOutcome >= 0.65;
  const reverseDirection = reversedSubject >= 0.65 && reversedOutcome >= 0.65;

  const statementSimilarity = semanticSimilarity(a.statement || '', b.statement || '');
  const combinedA = `${a.subject} ${a.outcome} ${a.statement || ''}`;
  const combinedB = `${b.subject} ${b.outcome} ${b.statement || ''}`;

  if (sameDirection) {
    if (oppositePolarity(a.effectPolarity, b.effectPolarity)
      || (a.claimType === 'null_finding') !== (b.claimType === 'null_finding')) return 'contradictory';
    return conditionCompatibility(a.conditions, b.conditions) >= 0.25 ? 'equivalent' : 'overlapping';
  }
  if (reverseDirection) return 'reverse_direction';
  if (hasMorphologicalScopeTension(combinedA, combinedB)) return 'scope_tension';
  if (sameSubject >= 0.45 || statementSimilarity >= 0.38) return 'complementary';
  if (context.sharedEvidenceContext) return 'shared_context';
  return 'unrelated';
}

export interface RuleV3ClusterInput extends RuleV3RelationInput {
  id: string;
  evidenceChunkIds?: string[];
  questionKind?: string;
}

export interface RuleV3ConceptCluster {
  clusterId: string;
  memberIds: string[];
  memberCount: number;
  relationshipKinds: RuleV3Relationship[];
}

// Groups meaningful rule relationships for review without merging database records.
export function buildRuleV3ConceptClusters(inputs: RuleV3ClusterInput[]): Map<string, RuleV3ConceptCluster> {
  const parent = new Map(inputs.map(item => [item.id, item.id]));
  const edges: Array<{ left: string; right: string; relationship: RuleV3Relationship }> = [];
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot.localeCompare(rightRoot) <= 0 ? leftRoot : rightRoot);
    if (leftRoot !== rightRoot && leftRoot.localeCompare(rightRoot) > 0) parent.set(leftRoot, rightRoot);
  };

  for (let leftIndex = 0; leftIndex < inputs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < inputs.length; rightIndex += 1) {
      const left = inputs[leftIndex];
      const right = inputs[rightIndex];
      const rightChunks = new Set(right.evidenceChunkIds || []);
      const sharedEvidenceContext = (left.evidenceChunkIds || []).some(chunkId => rightChunks.has(chunkId));
      const relationship = classifyRuleV3Relationship(left, right, { sharedEvidenceContext });
      if (!['equivalent', 'overlapping', 'contradictory', 'reverse_direction', 'scope_tension', 'shared_context'].includes(relationship)) continue;
      union(left.id, right.id);
      edges.push({ left: left.id, right: right.id, relationship });
    }
  }

  const membersByRoot = new Map<string, string[]>();
  for (const item of inputs) {
    const root = find(item.id);
    const members = membersByRoot.get(root) || [];
    members.push(item.id);
    membersByRoot.set(root, members);
  }
  const output = new Map<string, RuleV3ConceptCluster>();
  for (const members of membersByRoot.values()) {
    const memberIds = [...members].sort();
    const memberSet = new Set(memberIds);
    const relationshipKinds = [...new Set(edges
      .filter(edge => memberSet.has(edge.left) && memberSet.has(edge.right))
      .map(edge => edge.relationship))];
    const cluster = {
      clusterId: `rule-cluster:${memberIds[0]}`,
      memberIds,
      memberCount: memberIds.length,
      relationshipKinds,
    };
    for (const memberId of memberIds) output.set(memberId, cluster);
  }
  return output;
}
