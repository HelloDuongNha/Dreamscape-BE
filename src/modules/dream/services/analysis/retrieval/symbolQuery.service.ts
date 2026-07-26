export interface SymbolQuery {
  normalizedText: string;
  tokens: string[];
  tokenSet: Set<string>;
  ngramSet: Set<string>;
  extractedKeywords: string[];
  keywordSet: Set<string>;
}

/**
 * Builds language-agnostic lexical boundaries for exact matching.
 *
 * Semantic retrieval embeds the original narrative, so this function must not
 * translate, classify, or discard words. Exact aliases belong to DreamSymbol
 * data (`symbol`, `variants`, `canonicalSymbol`) rather than source code.
 */
export function prepareSymbolQuery(narrative: string): SymbolQuery {
  const normalizedText = narrative
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const tokens = normalizedText.match(/[\p{L}\p{N}]+/gu) || [];
  const ngramSet = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    for (let size = 2; size <= 4 && index + size <= tokens.length; size += 1) {
      ngramSet.add(tokens.slice(index, index + size).join(' '));
    }
  }

  const extractedKeywords = [...new Set([
    ...tokens.filter(token => token.length >= 2),
    ...ngramSet,
  ])].slice(0, 120);

  return {
    normalizedText,
    tokens,
    tokenSet: new Set(tokens),
    ngramSet,
    extractedKeywords,
    keywordSet: new Set(extractedKeywords),
  };
}
