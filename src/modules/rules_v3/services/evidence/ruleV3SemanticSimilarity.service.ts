const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'that', 'the', 'to', 'with',
  'các', 'có', 'của', 'do', 'được', 'là', 'một', 'những', 'ở', 'theo', 'trong', 'và', 'với',
]);

const GENERIC_RULE_WORDS = new Set([
  'content', 'dream', 'giấc', 'mơ', 'nội', 'orient', 'process', 'quá', 'relate', 'trình',
]);

const NEGATING_PREFIXES = ['counter', 'non', 'dis', 'im', 'in', 'ir', 'il', 'un'];
const ADJECTIVE_ENDINGS = ['able', 'ible', 'ive', 'al', 'ary', 'ous', 'ent', 'ant', 'ic'];

// Compares bilingual rule text without relying on aliases for individual examples.
export function semanticSimilarity(left: string, right: string): number {
  return tokenSetSimilarity(tokenize(left), tokenize(right));
}

// Ignores generic rule words so a shared word such as “dream” cannot force a merge.
export function meaningfulSemanticSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left).filter(token => !GENERIC_RULE_WORDS.has(token));
  const rightTokens = tokenize(right).filter(token => !GENERIC_RULE_WORDS.has(token));
  return tokenSetSimilarity(leftTokens, rightTokens);
}

// Detects a broad positive/negated scope contrast inside a shared semantic domain.
export function hasMorphologicalScopeTension(left: string, right: string): boolean {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const leftNegated = leftTokens.some(isMorphologicallyNegated);
  const rightNegated = rightTokens.some(isMorphologicallyNegated);
  if (leftNegated === rightNegated) return false;
  return tokenSetSimilarity(leftTokens, rightTokens) >= 0.08;
}

function tokenize(value: string): string[] {
  return [...new Set(value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .map(normalizeToken)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token)))];
}

function normalizeToken(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 6) return trimRepeatedEnding(token.slice(0, -3));
  if (token.endsWith('ied') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ed') && token.length > 5) return trimRepeatedEnding(token.slice(0, -2));
  if (token.endsWith('es') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function trimRepeatedEnding(token: string): string {
  const last = token[token.length - 1];
  const previous = token[token.length - 2];
  return last && last === previous ? token.slice(0, -1) : token;
}

function tokenSetSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const unmatchedRight = [...right];
  let matched = 0;

  for (const leftToken of left) {
    const matchIndex = unmatchedRight.findIndex(rightToken =>
      tokensAreEquivalent(leftToken, rightToken),
    );
    if (matchIndex < 0) continue;
    matched += 1;
    unmatchedRight.splice(matchIndex, 1);
  }

  return matched / (left.length + right.length - matched);
}

function tokensAreEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  const sharedLength = commonPrefixLength(left, right);
  return sharedLength >= 5 && sharedLength / Math.min(left.length, right.length) >= 0.75;
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function isMorphologicallyNegated(token: string): boolean {
  if (!ADJECTIVE_ENDINGS.some(ending => token.endsWith(ending))) return false;
  return NEGATING_PREFIXES.some(prefix => {
    if (!token.startsWith(prefix)) return false;
    const base = token.slice(prefix.length);
    return base.length >= 4 && /[aeiouy]/u.test(base);
  });
}
