export type RuleV3Relationship = 'equivalent' | 'overlapping' | 'contradictory' | 'reverse_direction' | 'unrelated';

export interface RuleV3RelationInput {
  subject: string;
  outcome: string;
  claimType: string;
  effectPolarity: string;
  conditions?: string[];
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
    .map(token => token === 'threaten' ? 'threat' : token)
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

function conditionCompatibility(a: string[] = [], b: string[] = []): number {
  if (a.length === 0 || b.length === 0) return 1;
  return similarity(a.join(' '), b.join(' '));
}

function oppositePolarity(a: string, b: string): boolean {
  return (a === 'positive' && b === 'negative') || (a === 'negative' && b === 'positive');
}

export function classifyRuleV3Relationship(a: RuleV3RelationInput, b: RuleV3RelationInput): RuleV3Relationship {
  const sameSubject = similarity(a.subject, b.subject);
  const sameOutcome = similarity(a.outcome, b.outcome);
  const reversedSubject = similarity(a.subject, b.outcome);
  const reversedOutcome = similarity(a.outcome, b.subject);
  const sameDirection = sameSubject >= 0.65 && sameOutcome >= 0.65;
  const reverseDirection = reversedSubject >= 0.65 && reversedOutcome >= 0.65;

  if (sameDirection) {
    if (oppositePolarity(a.effectPolarity, b.effectPolarity)
      || (a.claimType === 'null_finding') !== (b.claimType === 'null_finding')) return 'contradictory';
    return conditionCompatibility(a.conditions, b.conditions) >= 0.25 ? 'equivalent' : 'overlapping';
  }
  if (reverseDirection) return 'reverse_direction';
  return 'unrelated';
}
