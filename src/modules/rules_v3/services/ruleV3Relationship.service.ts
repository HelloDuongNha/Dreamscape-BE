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
  | 'same_question_and_semantics';

export interface RuleV3MergeAssessment {
  canMerge: boolean;
  reasons: RuleV3MergeReason[];
  subjectSimilarity: number;
  outcomeSimilarity: number;
  statementSimilarity: number;
  signals: RuleV3RelationshipSignal[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'that', 'the', 'to', 'with',
  'các', 'có', 'của', 'do', 'được', 'là', 'một', 'những', 'ở', 'theo', 'trong', 'và', 'với'
]);

function tokens(value: string): Set<string> {
  return new Set(value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .map(token => token.replace(/(?:ing|ed|es|s)$/u, ''))
    .map(token => ({
      dream: 'dream', dreaming: 'dream', dreamed: 'dream',
      memorie: 'memory', memory: 'memory',
      simulation: 'simulation', simulate: 'simulation',
      thought: 'cognition', thinking: 'cognition', cognition: 'cognition',
      threaten: 'threat', threat: 'threat',
      event: 'event',
      implausible: 'unrealistic', unrealistic: 'unrealistic', impossible: 'unrealistic',
    } as Record<string, string>)[token] || token)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token)));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function meaningfulSimilarity(left: string, right: string): number {
  const generic = new Set(['dream', 'dreaming', 'giấc', 'mơ', 'content', 'nội', 'dung', 'process', 'quá', 'trình', 'relat', 'orient']);
  const a = new Set([...tokens(left)].filter(token => !generic.has(token)));
  const b = new Set([...tokens(right)].filter(token => !generic.has(token)));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

export function assessRuleV3MergeCompatibility(
  a: RuleV3RelationInput,
  b: RuleV3RelationInput,
  context: RuleV3RelationshipContext = {},
): RuleV3MergeAssessment {
  const subjectSimilarity = meaningfulSimilarity(a.subject, b.subject);
  const outcomeSimilarity = meaningfulSimilarity(a.outcome, b.outcome);
  const statementSimilarity = similarity(a.statement || '', b.statement || '');
  const rawSubjectSimilarity = similarity(a.subject, b.subject);
  const rawOutcomeSimilarity = similarity(a.outcome, b.outcome);
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

function conditionCompatibility(a: string[] = [], b: string[] = []): number {
  if (a.length === 0 || b.length === 0) return 1;
  return similarity(a.join(' '), b.join(' '));
}

function oppositePolarity(a: string, b: string): boolean {
  return (a === 'positive' && b === 'negative') || (a === 'negative' && b === 'positive');
}

export function classifyRuleV3Relationship(
  a: RuleV3RelationInput,
  b: RuleV3RelationInput,
  context: RuleV3RelationshipContext = {},
): RuleV3Relationship {
  const sameSubject = similarity(a.subject, b.subject);
  const sameOutcome = similarity(a.outcome, b.outcome);
  const reversedSubject = similarity(a.subject, b.outcome);
  const reversedOutcome = similarity(a.outcome, b.subject);
  const sameDirection = sameSubject >= 0.65 && sameOutcome >= 0.65;
  const reverseDirection = reversedSubject >= 0.65 && reversedOutcome >= 0.65;

  const statementSimilarity = similarity(a.statement || '', b.statement || '');
  const combinedA = `${a.subject} ${a.outcome} ${a.statement || ''}`.toLowerCase();
  const combinedB = `${b.subject} ${b.outcome} ${b.statement || ''}`.toLowerCase();
  const realisticTension = (/(?:realistic|reality)/u.test(combinedA) && /(?:implausible|unrealistic|impossible)/u.test(combinedB))
    || (/(?:realistic|reality)/u.test(combinedB) && /(?:implausible|unrealistic|impossible)/u.test(combinedA));
  const bothAboutDreams = /dream/u.test(combinedA) && /dream/u.test(combinedB);

  if (sameDirection) {
    if (oppositePolarity(a.effectPolarity, b.effectPolarity)
      || (a.claimType === 'null_finding') !== (b.claimType === 'null_finding')) return 'contradictory';
    return conditionCompatibility(a.conditions, b.conditions) >= 0.25 ? 'equivalent' : 'overlapping';
  }
  if (reverseDirection) return 'reverse_direction';
  if (realisticTension && bothAboutDreams) return 'scope_tension';
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

export interface RuleV3MergeCluster {
  clusterId: string;
  memberIds: string[];
  memberCount: number;
  reasons: RuleV3MergeReason[];
}

/** Presentation clusters contain only records that the merge endpoint can
 * actually combine. Related-but-distinct claims are deliberately omitted. */
export function buildRuleV3MergeClusters(inputs: RuleV3ClusterInput[]): Map<string, RuleV3MergeCluster> {
  const sorted = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const groups: RuleV3ClusterInput[][] = [];
  const pairAssessment = (left: RuleV3ClusterInput, right: RuleV3ClusterInput) => {
      const rightChunks = new Set(right.evidenceChunkIds || []);
      const sharedEvidenceContext = (left.evidenceChunkIds || []).some(id => rightChunks.has(id));
      return assessRuleV3MergeCompatibility(left, right, {
        sharedEvidenceContext,
        sameQuestionKind: Boolean(left.questionKind && left.questionKind !== 'none' && left.questionKind === right.questionKind),
      });
  };
  for (const input of sorted) {
    const target = groups.find(group => group.every(member => pairAssessment(member, input).canMerge));
    if (target) target.push(input); else groups.push([input]);
  }
  const output = new Map<string, RuleV3MergeCluster>();
  for (const members of groups) {
    if (members.length < 2) continue;
    const memberIds = members.map(item => item.id).sort();
    const reasons = members.flatMap((left, index) => members.slice(index + 1).flatMap(right => pairAssessment(left, right).reasons));
    const cluster = {
      clusterId: `merge-cluster:${memberIds[0]}`,
      memberIds,
      memberCount: memberIds.length,
      reasons: [...new Set(reasons)],
    };
    for (const id of memberIds) output.set(id, cluster);
  }
  return output;
}

/**
 * Atomic rules remain independently reviewable and scoreable. This graph
 * groups rules only for presentation and synthesis: equivalent/contradictory
 * links, scope tensions, or claims grounded in the same canonical paragraph.
 * Merely sharing a generic subject such as "dreaming" is not enough to merge
 * database records.
 */
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
