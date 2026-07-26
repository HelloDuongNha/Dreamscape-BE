export function normalizeMatchText(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function removeVietnameseDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function hasTokenOrNgram(values: Set<string>, target: string): boolean {
  return values.has(normalizeMatchText(target));
}

export function findExactDatabaseVariant(
  variants: string[],
  tokens: Set<string>,
  ngrams: Set<string>,
): string | undefined {
  return variants
    .map(normalizeMatchText)
    .filter(Boolean)
    .sort((first, second) => second.length - first.length)
    .find(variant => hasTokenOrNgram(
      variant.includes(' ') ? ngrams : tokens,
      variant,
    ));
}

export function isStrictExactMatch(
  normalizedSymbol: string,
  tokens: Set<string>,
  ngrams: Set<string>,
  _isEnglish?: boolean,
): { matched: boolean } {
  const normalized = normalizeMatchText(normalizedSymbol);
  return {
    matched: hasTokenOrNgram(normalized.includes(' ') ? ngrams : tokens, normalized),
  };
}

export function isMoreSpecificSymbol(first: string, second: string): boolean {
  const firstWords = normalizeMatchText(first).split(/\s+/u).filter(Boolean).length;
  const secondWords = normalizeMatchText(second).split(/\s+/u).filter(Boolean).length;
  if (firstWords !== secondWords) return firstWords > secondWords;
  return first.length > second.length;
}
