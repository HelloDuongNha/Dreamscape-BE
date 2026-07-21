const VI_WORDS = /\b(và|của|các|trong|được|một|những|không|người|giấc|mơ|nghiên cứu|kết quả|chương)\b/giu;
const EN_WORDS = /\b(the|and|of|in|to|was|were|with|dream|study|results|chapter)\b/giu;
const VI_DIACRITICS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu;

export function normalizeDocumentLanguage(value?: string): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return undefined;
  if (/^(vi|vie|vi-vn|vi-vt|vietnamese|tiếng việt)$/.test(normalized)) return 'vi';
  if (/^(en|eng|en-us|en-gb|english)$/.test(normalized)) return 'en';
  const primary = normalized.split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

/** Conservative deterministic fallback for the two product languages. */
export function inferDocumentLanguage(textSamples: string[]): 'vi' | 'en' | 'unknown' {
  const text = textSamples.join('\n').slice(0, 40_000);
  if (!text.trim()) return 'unknown';
  const viWords = text.match(VI_WORDS)?.length || 0;
  const enWords = text.match(EN_WORDS)?.length || 0;
  const viMarks = text.match(VI_DIACRITICS)?.length || 0;
  const viScore = viWords * 4 + Math.min(viMarks, 40);
  const enScore = enWords * 4;
  if (viScore >= 12 && viScore > enScore * 1.15) return 'vi';
  if (enScore >= 12 && enScore > viScore * 1.15) return 'en';
  return 'unknown';
}
