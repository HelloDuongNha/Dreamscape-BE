import mongoose from 'mongoose';
import { logger } from '../infrastructure/logger';
import DreamSymbol from '../../models/DreamSymbol';
import { generateEmbedding } from '../infrastructure/llm.service';

export interface IRetrievedSymbol {
  symbol: string;
  category: string;
  symbolValence: number;
  rawSimilarityScore: number | null;
  adjustedScore: number;
  retrievalMethods: string[];
  lowConfidence: boolean;
  fallbackReason: string | null;
  interpretation?: string;
  boostReasons: string[];
  suppressedBoostReasons: string[];
  canonicalSymbol: string;
  matchedVariants: string[];
  matchedTextVariant?: string;
  metadataFromVariant?: string;
}

/**
 * Computes cosine similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple suffix helper (e.g. falling -> fall, screaming -> scream).
 */
function cleanSuffix(word: string): string {
  const lowercase = word.toLowerCase().trim();
  if (lowercase.endsWith('ing')) {
    if (lowercase.endsWith('ning') && lowercase.length > 5) {
      return lowercase.slice(0, -4); // e.g. running -> run
    }
    return lowercase.slice(0, -3);
  }
  return lowercase;
}

/**
 * Checks if a symbol matches normalized string criteria safely.
 */
export function removeVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function isLikelyEnglish(dreamText: string): boolean {
  const englishIndicators = ['the', 'of', 'and', 'to', 'a', 'is', 'in', 'that', 'was', 'for', 'on', 'with', 'had', 'were', 'this', 'you', 'i'];
  const clean = dreamText.toLowerCase();
  const hasDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(clean);
  if (hasDiacritics) return false;
  
  const tokens = clean.split(/\s+/);
  const count = tokens.filter(t => englishIndicators.includes(t)).length;
  return count >= 2;
}

const variantMap: Record<string, string[]> = {
  "fall": ["fall", "falling", "fell"],
  "scream": ["scream", "screaming", "screamed"],
  "eat": ["eat", "eating", "ate", "food", "meal", "dinner", "lunch", "breakfast", "ăn", "ăn cơm", "bữa ăn", "đồ ăn"],
  "eating": ["eat", "eating", "ate", "food", "meal", "dinner", "lunch", "breakfast", "ăn", "ăn cơm", "bữa ăn", "đồ ăn"],
  "chase": ["chase", "chasing", "chased", "bị đuổi", "đuổi theo", "rượt đuổi"],
  "run": ["run", "running", "ran", "chạy", "chạy trốn"],
  "fear": ["fear", "fearing", "feared", "sợ"],
  "panic": ["panic", "panicked", "panicking", "hoảng loạn"],
  "trap": ["trap", "trapped", "trapping", "mắc kẹt"],
  "trapped": ["trap", "trapped", "trapping", "mắc kẹt"],
  "building": ["building", "buildings", "tòa nhà"],
  "house": ["house", "houses", "nhà"],
  "snake": ["snake", "snakes", "rắn"],
  "fire": ["fire", "fires", "lửa"],
  "water": ["water", "nước"],
  "school": ["school", "schools", "trường học", "trường"],
  "exam": ["exam", "exams", "thi"]
};

function hasTokenOrNgram(set: Set<string>, target: string, isEnglish: boolean): boolean {
  const normTarget = target.toLowerCase().trim();
  const diacriticFreeTarget = removeVietnameseDiacritics(normTarget);
  const targetActuallyHasVietnameseDiacritics = diacriticFreeTarget !== normTarget;
  
  if (isEnglish) {
    if (diacriticFreeTarget === 'an' && normTarget === 'ăn') {
      return set.has('ăn');
    }
    if (diacriticFreeTarget === 'ran' && normTarget === 'rắn') {
      return set.has('rắn');
    }
  }

  if (set.has(normTarget)) {
    return true;
  }
  // Only a Vietnamese target is allowed to use its own diacritic-free alias.
  // Folding every source token made English "cap" match Vietnamese "cấp" and
  // English "can" match Vietnamese "căn".
  if (targetActuallyHasVietnameseDiacritics && set.has(diacriticFreeTarget)) return true;
  for (const item of set) {
    const normItem = item.toLowerCase().trim();
    if (normItem === normTarget) {
      return true;
    }
    if (targetActuallyHasVietnameseDiacritics
      && removeVietnameseDiacritics(normItem) === diacriticFreeTarget) return true;
  }
  return false;
}

export function isStrictExactMatch(
  normSym: string,
  tokensSet: Set<string>,
  ngramSet: Set<string>,
  isEnglish: boolean
): { matched: boolean; reason?: 'variant_not_supported' | 'suffix_match_rejected:not_in_variant_map' | 'substring_match_rejected:no_token_boundary' } {
  const isMultiWord = normSym.includes(' ');

  if (isMultiWord) {
    if (hasTokenOrNgram(ngramSet, normSym, isEnglish)) {
      return { matched: true };
    }
    return { matched: false };
  } else {
    // Single-word symbol
    if (variantMap[normSym]) {
      const variants = variantMap[normSym];
      for (const v of variants) {
        const setToCheck = v.includes(' ') ? ngramSet : tokensSet;
        if (hasTokenOrNgram(setToCheck, v, isEnglish)) {
          return { matched: true };
        }
      }
      return { matched: false, reason: 'variant_not_supported' };
    }

    // No variant map exists: match exact token only
    if (hasTokenOrNgram(tokensSet, normSym, isEnglish)) {
      return { matched: true };
    }

    // Since no variant map exists, do not do suffix/lemma checks.
    // If it's a potential suffix form and didn't match, we reject it.
    const isPotentialSuffix = normSym.endsWith('ing') || normSym.endsWith('ed') || normSym.endsWith('s') || normSym.endsWith('es');
    if (isPotentialSuffix) {
      return { matched: false, reason: 'suffix_match_rejected:not_in_variant_map' };
    }

    return { matched: false };
  }
}

export function hasStandaloneVietnameseHouseMeaning(tokens: string[]): boolean {
  const blockedFollowingWords = new Set(['ga', 'trường', 'máy', 'hàng', 'thờ', 'hát', 'nước', 'xuất']);
  const blockedPrecedingWords = new Set(['mái', 'sàn']);
  return tokens.some((token, index) => token === 'nhà'
    && !blockedFollowingWords.has(tokens[index + 1] || '')
    && !blockedPrecedingWords.has(tokens[index - 1] || ''));
}

/**
 * Helper to determine if a symbol's occurrences in the dream text are entirely inside known noise phrases.
 */
export function isExclusivelyInNoisePhrases(
  normalizedSymbol: string,
  normalizedDreamText: string,
  noisePhrases: string[]
): { exclusively: boolean; matchedNoisePhrase: string | null } {
  if (normalizedSymbol.length === 0) {
    return { exclusively: false, matchedNoisePhrase: null };
  }

  // Find all character index positions of normalizedSymbol in normalizedDreamText
  const occurrences: number[] = [];
  let pos = normalizedDreamText.indexOf(normalizedSymbol);
  while (pos !== -1) {
    occurrences.push(pos);
    pos = normalizedDreamText.indexOf(normalizedSymbol, pos + 1);
  }

  if (occurrences.length === 0) {
    return { exclusively: false, matchedNoisePhrase: null };
  }

  // Find range boundaries of all noise phrases present in normalizedDreamText
  interface Range {
    start: number;
    end: number;
    phrase: string;
  }
  const noiseRanges: Range[] = [];
  for (const phrase of noisePhrases) {
    let phrasePos = normalizedDreamText.indexOf(phrase);
    while (phrasePos !== -1) {
      noiseRanges.push({
        start: phrasePos,
        end: phrasePos + phrase.length,
        phrase: phrase,
      });
      phrasePos = normalizedDreamText.indexOf(phrase, phrasePos + 1);
    }
  }

  // Check if every symbol occurrence index is bounded within a noise phrase range
  let coveredCount = 0;
  let firstMatchedPhrase: string | null = null;

  for (const symbolPos of occurrences) {
    const symbolEnd = symbolPos + normalizedSymbol.length;
    let isCovered = false;
    for (const range of noiseRanges) {
      if (symbolPos >= range.start && symbolEnd <= range.end) {
        isCovered = true;
        if (!firstMatchedPhrase) {
          firstMatchedPhrase = range.phrase;
        }
        break;
      }
    }
    if (isCovered) {
      coveredCount++;
    }
  }

  return {
    exclusively: coveredCount === occurrences.length,
    matchedNoisePhrase: firstMatchedPhrase,
  };
}

/**
 * Fetch vector similarity scores from DB ($vectorSearch) or Fallback (In-memory Cosine)
 */
async function getVectorScores(
  queryVector: number[] | null
): Promise<{ scores: Map<string, number>; backend: 'mongodb_vector_search' | 'in_memory_cosine_fallback' }> {
  const scoresMap = new Map<string, number>();
  if (!queryVector) {
    return { scores: scoresMap, backend: 'in_memory_cosine_fallback' };
  }

  try {
    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: queryVector,
          numCandidates: 100,
          limit: 100,
        },
      },
      {
        $project: {
          symbol: 1,
          similarityScore: { $meta: 'vectorSearchScore' },
        },
      },
    ];
    const results = await DreamSymbol.aggregate(pipeline);
    if (Array.isArray(results) && results.length > 0) {
      for (const item of results) {
        scoresMap.set(item.symbol.toLowerCase(), item.similarityScore);
      }
      return { scores: scoresMap, backend: 'mongodb_vector_search' };
    }
  } catch (err: any) {
    // Graceful degradation
  }

  const allSymbols = await DreamSymbol.find().lean() as any[];
  for (const s of allSymbols) {
    if (s.embedding && Array.isArray(s.embedding) && s.embedding.length === 768) {
      const score = cosineSimilarity(queryVector, s.embedding);
      scoresMap.set(s.symbol.toLowerCase(), score);
    }
  }
  return { scores: scoresMap, backend: 'in_memory_cosine_fallback' };
}

export interface IDreamSegments {
  rawText: string;
  dreamNarrative: string;
  wakingReactionText: string;
  sleepContextText: string;
  segmentationReasons: string[];
}

function splitSentenceIntoClauses(sentence: string): string[] {
  return sentence.split(/,\s+(?=then\b|and\s+then\b|but\b|although\b|even though\b|dù\s|mặc dù\s|ngoài đời(?:\s|,))|\s+(?=then\b|and\s+then\b)/i);
}

export function isExplicitSleepContextClause(clause: string): { matched: boolean; trigger?: string; reason?: string } {
  const lower = clause.toLowerCase();

  // 1. Direct explicit indicators
  const ExplicitDirectSleepTriggers = [
    "ngủ muộn", "ngu muon", "ăn khuya", "an khuya",
    "slept late", "sleep late", "ate late", "late meal", "heavy eating"
  ];
  for (const trigger of ExplicitDirectSleepTriggers) {
    if (lower.includes(trigger)) {
      return { matched: true, trigger, reason: "explicit_direct_indicator" };
    }
  }

  // 2. Sleep Posture detection rule
  const EnglishPostureKeywords = ['sleep', 'slept', 'sleeping', 'asleep', 'bed', 'lie', 'lay', 'lying', 'position', 'posture', 'supine', 'prone'];
  const EnglishPosturePhrases = ['on my back', 'on my stomach', 'on my side', 'face down', 'face up', 'supine', 'prone'];
  
  const VietnamesePostureKeywords = ['ngủ', 'ngu', 'lúc ngủ', 'luc ngu', 'khi ngủ', 'khi ngu', 'đang ngủ', 'dang ngu', 'tư thế ngủ', 'tu the ngu', 'trên giường', 'tren giuong'];
  const VietnamesePosturePhrases = ['nằm ngửa', 'nam ngua', 'nằm sấp', 'nam sap', 'nằm nghiêng', 'nam nghieng', 'úp mặt', 'up mat', 'ngửa mặt', 'ngua mat'];

  // Match English posture
  const hasEnglishPostureKeyword = EnglishPostureKeywords.some(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });
  const hasEnglishPosturePhrase = EnglishPosturePhrases.some(p => lower.includes(p));

  // Match Vietnamese posture
  const hasVietnamesePostureKeyword = VietnamesePostureKeywords.some(kw => {
    const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|[.,!?;])${escaped}(?:$|\\s|[.,!?;])`, 'i');
    return regex.test(lower);
  });
  const hasVietnamesePosturePhrase = VietnamesePosturePhrases.some(p => lower.includes(p));

  if ((hasEnglishPostureKeyword && hasEnglishPosturePhrase) || (hasVietnamesePostureKeyword && hasVietnamesePosturePhrase)) {
    return { matched: true, trigger: "posture_match", reason: "sleep_posture_detected" };
  }

  // 3. Environment/Temperature detection rule
  const TempKeywordsEn = ['hot', 'cold', 'warm', 'cool'];
  const TempKeywordsVi = ['nóng', 'nong', 'lạnh', 'lanh', 'ấm', 'am', 'mát', 'mat'];

  const RoomKeywordsEn = ['room', 'bedroom', 'bed'];
  const RoomKeywordsVi = ['phòng', 'phong', 'phòng ngủ', 'phong ngu', 'giường', 'giuong'];

  const SleepKeywordsEn = ['sleep', 'slept', 'sleeping', 'asleep', 'bedroom'];
  const SleepKeywordsVi = ['ngủ', 'ngu', 'lúc ngủ', 'luc ngu', 'khi ngủ', 'khi ngu', 'đang ngủ', 'dang ngu', 'phòng ngủ', 'phong ngu'];

  // Check English environment
  const hasSleepEn = SleepKeywordsEn.some(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });
  const hasTempEn = TempKeywordsEn.some(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });
  const hasRoomEn = RoomKeywordsEn.some(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(lower);
  });

  // Check Vietnamese environment
  const hasSleepVi = SleepKeywordsVi.some(kw => {
    const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|[.,!?;])${escaped}(?:$|\\s|[.,!?;])`, 'i');
    return regex.test(lower);
  });
  const hasTempVi = TempKeywordsVi.some(kw => {
    const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|[.,!?;])${escaped}(?:$|\\s|[.,!?;])`, 'i');
    return regex.test(lower);
  });
  const hasRoomVi = RoomKeywordsVi.some(kw => {
    const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s|[.,!?;])${escaped}(?:$|\\s|[.,!?;])`, 'i');
    return regex.test(lower);
  });

  if ((hasSleepEn && hasTempEn && hasRoomEn) || (hasSleepVi && hasTempVi && hasRoomVi)) {
    return { matched: true, trigger: "temperature_match", reason: "sleep_environment_temperature_detected" };
  }

  return { matched: false };
}

export function extractDreamSegments(rawText: string): IDreamSegments {
  const sentences = rawText.split(/(?<=[.!?;\n])\s+/);
  
  const dreamNarrativeParts: string[] = [];
  const wakingReactionParts: string[] = [];
  const sleepContextParts: string[] = [];
  const segmentationReasons: string[] = [];
  let explicitWakingContextStarted = false;

  const wakingContextPrefixes = [
    'ngoài đời', 'trong thực tế', 'thực tế là', 'tuần vừa rồi', 'gần đây', 'hiện tại',
    'in real life', 'in reality', 'last week', 'recently', 'currently',
  ];
  const embeddedWakingContextPatterns = [
    /^(?:dù|mặc dù)\s+(?:ngày mai|hôm nay|tuần này|sắp tới)\b/i,
    /^(?:although|even though)\s+(?:tomorrow|today|this week|soon)\b/i,
  ];

  const dreamSceneTriggers = [
    "woke up in",
    "woke up inside",
    "woke up and saw",
    "woke up and realized",
    "woke up and found",
    "tỉnh dậy trong",
    "tỉnh dậy thấy",
    "tỉnh dậy và thấy",
    "tỉnh dậy và nhận ra",
    "tỉnh dậy phát hiện",
    "tinh day trong",
    "tinh day thay",
    "tinh day va thay",
    "tinh day va nhan ra",
    "tinh day phat hien"
  ];

  const wakingReactionTriggers = [
    "woke up sweating",
    "woke up scared",
    "woke up crying",
    "woke up shaking",
    "woke up with my heart racing",
    "woke up feeling",
    "after i woke up",
    "when i woke up",
    "realized it was a dream",
    "then i woke up",
    "woke up again",
    "woke up screaming",
    "sau khi tỉnh dậy",
    "tỉnh dậy thì",
    "lúc tỉnh dậy",
    "mình tỉnh dậy",
    "tim đập nhanh",
    "đổ mồ hôi",
    "toát mồ hôi",
    "sau khi tinh day",
    "tinh day thi",
    "luc tinh day",
    "minh tinh day",
    "tim dap nhanh",
    "do mo hoi",
    "toat mo hoi"
  ];

  for (const sentence of sentences) {
    const trimmedSent = sentence.trim();
    if (!trimmedSent) continue;
    
    // Split sentence into clauses
    const clauses = splitSentenceIntoClauses(trimmedSent);
    
    for (const clause of clauses) {
      const trimmedClause = clause.trim();
      if (!trimmedClause) continue;
      
      const sleepCheck = isExplicitSleepContextClause(trimmedClause);
      
      let isDreamScene = false;
      let matchedSceneTrigger = "";
      const lower = trimmedClause.toLowerCase();
      const beginsWakingContext = wakingContextPrefixes.some(prefix => lower.startsWith(prefix));
      const isEmbeddedWakingContext = embeddedWakingContextPatterns.some(pattern => pattern.test(trimmedClause));
      if (beginsWakingContext) explicitWakingContextStarted = true;
      for (const trigger of dreamSceneTriggers) {
        if (lower.includes(trigger)) {
          isDreamScene = true;
          matchedSceneTrigger = trigger;
          break;
        }
      }
      
      let isWakingReaction = false;
      let matchedReactionTrigger = "";
      for (const trigger of wakingReactionTriggers) {
        if (lower.includes(trigger)) {
          isWakingReaction = true;
          matchedReactionTrigger = trigger;
          break;
        }
      }
      
      if (explicitWakingContextStarted || isEmbeddedWakingContext) {
        wakingReactionParts.push(trimmedClause);
        segmentationReasons.push(`Moved "${trimmedClause}" to wakingReactionText due to explicit waking-life context`);
      } else if (sleepCheck.matched) {
        sleepContextParts.push(trimmedClause);
        segmentationReasons.push(`Moved "${trimmedClause}" to sleepContextText due to trigger "${sleepCheck.trigger}" (${sleepCheck.reason})`);
      } else if (isWakingReaction) {
        wakingReactionParts.push(trimmedClause);
        segmentationReasons.push(`Moved "${trimmedClause}" to wakingReactionText due to trigger "${matchedReactionTrigger}"`);
      } else if (isDreamScene) {
        dreamNarrativeParts.push(trimmedClause);
        segmentationReasons.push(`Kept "${trimmedClause}" in dreamNarrative due to scene trigger "${matchedSceneTrigger}"`);
      } else {
        dreamNarrativeParts.push(trimmedClause);
      }
    }
  }
  
  let dreamNarrative = dreamNarrativeParts.join(" ");
  let wakingReactionText = wakingReactionParts.join(" ");
  let sleepContextText = sleepContextParts.join(" ");
  
  if (dreamNarrative.trim().length === 0) {
    dreamNarrative = rawText;
    segmentationReasons.push("fallback_raw_text_used_because_dreamNarrative_empty");
  }
  
  return {
    rawText,
    dreamNarrative,
    wakingReactionText,
    sleepContextText,
    segmentationReasons
  };
}

export const canonicalAliasMap: Record<string, string> = {
  "screaming": "Scream",
  "scream": "Scream",
  "chasing": "Chase",
  "chase": "Chase",
  "falling": "Fall",
  "falling from height": "Fall",
  "tall building": "Building",
  "trapped": "Trap",
  "trap": "Trap",
  "scared": "Fear",
  "fear": "Fear"
};

function isMoreSpecific(symA: string, symB: string): boolean {
  const wordsA = symA.split(/\s+/).filter(Boolean).length;
  const wordsB = symB.split(/\s+/).filter(Boolean).length;
  if (wordsA !== wordsB) {
    return wordsA > wordsB;
  }
  return symA.length > symB.length;
}

/**
 * Hybrid Symbol Retrieval Service combining Exact Match, Full-text Vector, and Phrase Vector with Context-Aware checks.
 */
export async function retrieveSymbolsHybrid(dreamText: string): Promise<{
  symbols: IRetrievedSymbol[];
  strategyUsed: 'hybrid_rerank';
  vectorBackend: 'mongodb_vector_search' | 'in_memory_cosine_fallback';
  extractedKeywords: string[];
  rawText: string;
  dreamNarrative: string;
  wakingReactionText: string;
  sleepContextText: string;
  segmentationReasons: string[];
}> {
  const segments = extractDreamSegments(dreamText);
  const narrativeText = segments.dreamNarrative;

  // 1. Normalize and tokenize text
  const normalizedDreamText = narrativeText.toLowerCase();
  const cleanText = normalizedDreamText
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleanText.split(' ').filter((t) => t.length > 0);

  // Stop words
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him', 'us', 'them', 'had', 'has', 'have', 'did', 'do', 'does', 'very', 'some', 'any', 'no', 'not', 'just', 'so', 'than', 'too', 'can', 'will',
    'và', 'hoặc', 'nhưng', 'nếu', 'thì', 'là', 'của', 'ở', 'trên', 'trong', 'dưới', 'bởi', 'cho', 'với', 'về', 'cái', 'con', 'chiếc', 'những', 'các', 'tôi', 'bạn', 'ta', 'chúng', 'mình', 'họ', 'nó', 'em', 'anh', 'chị', 'này', 'kia', 'đó', 'đây', 'đã', 'đang', 'sẽ', 'có', 'không', 'được', 'bị', 'một', 'hai', 'ba', 'nhiều', 'ít'
  ]);

  // High-value action/emotional words to always preserve
  const preservedWords = new Set([
    'falling', 'fall', 'scream', 'panic', 'fear', 'chase', 'chased', 'run', 'lost', 'trapped', 'death', 'water', 'fire', 'snake', 'house', 'school', 'exam', 'building', 'height'
  ]);

  // Bilingual Vietnamese to English mappings
  const bilingualMap: Record<string, string> = {
    'rơi': 'falling',
    'té': 'falling',
    'ngã': 'falling',
    'la hét': 'scream',
    'hét': 'scream',
    'sợ': 'fear',
    'hoảng loạn': 'panic',
    'tòa nhà': 'building',
    'nhà': 'house',
    'bị đuổi': 'chase',
    'chạy trốn': 'run',
    'lạc đường': 'lost',
    'mắc kẹt': 'trapped',
    'rắn': 'snake',
    'nước': 'water',
    'lửa': 'fire',
    'trường học': 'school',
    'thi': 'exam'
  };

  // Context-aware stoplist, noise phrases, and high-value whitelist
  const genericStoplist = new Set(['up', 'down', 'back', 'left', 'right', 'front', 'one', 'two', 'room', 'thing', 'person']);
  const noisePhrases = ['woke up', 'wake up', 'slept on my back', 'sleep on my back', 'on my back', 'very hot', 'hot room'];
  const whitelist = new Set(['fall', 'falling', 'scream', 'panic', 'fear', 'chase', 'trapped', 'building', 'height', 'snake', 'fire', 'water', 'house', 'school', 'exam']);

  const keywordsSet = new Set<string>();

  // Add tokens
  for (const token of tokens) {
    if (preservedWords.has(token) || !stopWords.has(token)) {
      keywordsSet.add(token);
    }
  }

  // Check bilingual mappings in raw dream text
  for (const [vietnameseKey, englishVal] of Object.entries(bilingualMap)) {
    if (normalizedDreamText.includes(vietnameseKey)) {
      keywordsSet.add(vietnameseKey);
      keywordsSet.add(englishVal);
    }
  }

  // Generate bigrams and trigrams
  for (let i = 0; i < tokens.length; i++) {
    if (i < tokens.length - 1) {
      keywordsSet.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    if (i < tokens.length - 2) {
      keywordsSet.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }

  const extractedKeywords = Array.from(keywordsSet);

  // Generate compacted keywords phrase
  const compactTokens = tokens.filter(
    (t) => preservedWords.has(t) || (!stopWords.has(t) && !vietnameseStopWordsMatch(t))
  );
  
  for (const [vietnameseKey, englishVal] of Object.entries(bilingualMap)) {
    if (normalizedDreamText.includes(vietnameseKey) && !compactTokens.includes(englishVal)) {
      compactTokens.push(englishVal);
    }
  }
  
  const compactPhraseQuery = compactTokens.join(' ');

  function vietnameseStopWordsMatch(t: string): boolean {
    const vnStops = ['và', 'hoặc', 'nhưng', 'nếu', 'thì', 'là', 'của', 'ở', 'trên', 'trong', 'dưới', 'bởi', 'cho', 'với', 'về', 'cái', 'con', 'chiếc', 'những', 'các', 'tôi', 'bạn', 'ta', 'chúng', 'mình', 'họ', 'nó', 'em', 'anh', 'chị', 'này', 'kia', 'đó', 'đây', 'đã', 'đang', 'sẽ', 'có', 'không', 'được', 'bị', 'một', 'hai', 'ba', 'nhiều', 'ít'];
    return vnStops.includes(t);
  }

  // 2. Request-level Embedding Cache
  const isOffline = process.env.RAG_OFFLINE === 'true';
  const fullTextEmbedding = isOffline ? null : await generateEmbedding(narrativeText);
  const { scores: fullTextScores, backend: fullTextBackend } = await getVectorScores(fullTextEmbedding);

  let phraseScores = new Map<string, number>();
  if (!isOffline && compactPhraseQuery.trim().length > 0) {
    const phraseEmbedding = await generateEmbedding(compactPhraseQuery);
    const { scores } = await getVectorScores(phraseEmbedding);
    phraseScores = scores;
  }

  const vectorBackend = fullTextBackend;

  // 3. Retrieve all symbols & compute exact match/rerank
  const allSymbols = await DreamSymbol.find().lean() as any[];
  const candidates: IRetrievedSymbol[] = [];

  let exactMatchCount = 0;
  let fullTextResultCount = 0;
  let phraseVectorCount = 0;

  const isEnglish = isLikelyEnglish(dreamText);

  const tokensSet = new Set(tokens);
  const ngramSet = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (i < tokens.length - 1) {
      ngramSet.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    if (i < tokens.length - 2) {
      ngramSet.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }

  for (const s of allSymbols) {
    const normSym = s.symbol.toLowerCase().trim();

    // Check strict matching
    const matchResult = isStrictExactMatch(normSym, tokensSet, ngramSet, isEnglish);
    let exact = matchResult.matched;
    let matchedTextVariant = exact
      ? (variantMap[normSym] || [normSym]).find(variant =>
          hasTokenOrNgram(variant.includes(' ') ? ngramSet : tokensSet, variant, isEnglish))
      : undefined;
    // Vietnamese "nhà" is part of many compound nouns. In "nhà ga" it
    // means station, not house. Treat House as exact only when at least one
    // occurrence is not consumed by a known compound noun.
    if (normSym === 'house' && matchedTextVariant === 'nhà') {
      if (!hasStandaloneVietnameseHouseMeaning(tokens)) {
        exact = false;
        matchedTextVariant = undefined;
      }
    }
    const appearsInText = exact;

    const fullTextScore = fullTextScores.get(normSym);
    const phraseScore = phraseScores.get(normSym);

    // Old loose match for suppressed reasons check
    let looseMatch = normalizedDreamText.includes(normSym);
    if (variantMap[normSym]) {
      for (const v of variantMap[normSym]) {
        if (normalizedDreamText.includes(v)) {
          looseMatch = true;
          break;
        }
      }
    }

    if (exact || fullTextScore !== undefined || phraseScore !== undefined) {
      if (exact) exactMatchCount++;
      if (fullTextScore !== undefined) fullTextResultCount++;
      if (phraseScore !== undefined) phraseVectorCount++;

      const scores: number[] = [];
      if (fullTextScore !== undefined) scores.push(fullTextScore);
      if (phraseScore !== undefined) scores.push(phraseScore);

      const rawSimilarityScore = scores.length > 0 ? Math.max(...scores) : null;

      // Adjusted score starting with raw vector score (or 0 if exact-only)
      let adjustedScore = rawSimilarityScore !== null ? rawSimilarityScore : 0.0;

      const retrievalMethods: string[] = [];
      if (exact) {
        retrievalMethods.push('exact_match');
      }
      if (fullTextScore !== undefined) {
        retrievalMethods.push('full_text_vector');
      }
      if (phraseScore !== undefined) {
        retrievalMethods.push('phrase_vector');
      }

      // Check exclusively in noise phrases
      const noiseCheckNorm = isExclusivelyInNoisePhrases(normSym, normalizedDreamText, noisePhrases);
      const isNoiseNorm = noiseCheckNorm.exclusively;
      const matchedNoisePhrase = noiseCheckNorm.matchedNoisePhrase;

      const inWhitelist = whitelist.has(normSym);
      const inStoplist = genericStoplist.has(normSym);
      const isLongEnough = normSym.length >= 3;

      const boostReasons: string[] = [];
      const suppressedBoostReasons: string[] = [];

      // A. Exact Match Boost (+0.20)
      if (exact) {
        if (inWhitelist) {
          adjustedScore += 0.20;
          boostReasons.push('high_value_whitelist');
        } else if (isNoiseNorm) {
          suppressedBoostReasons.push(`matched_only_in_noise_phrase:${matchedNoisePhrase}`);
        } else if (inStoplist) {
          suppressedBoostReasons.push('generic_stoplist');
        } else if (!isLongEnough) {
          suppressedBoostReasons.push('length_below_3_chars');
        } else {
          adjustedScore += 0.20;
          boostReasons.push('exact_match_approved');
        }
      }

      // B. Direct Occurrence Boost (+0.10)
      if (appearsInText) {
        if (isNoiseNorm) {
          suppressedBoostReasons.push(`occurrence_suppressed:matched_only_in_noise_phrase:${matchedNoisePhrase}`);
        } else {
          adjustedScore += 0.10;
          boostReasons.push('direct_occurrence');
        }
      }

      // C. Category Relevance Boost (+0.02, only when rawSimilarityScore >= 0.65)
      const normCat = s.category.toLowerCase().trim();
      let categoryRelevant = false;
      for (const kw of keywordsSet) {
        if (kw.includes(normCat) || normCat.includes(kw)) {
          categoryRelevant = true;
          break;
        }
      }
      if (categoryRelevant && rawSimilarityScore !== null && rawSimilarityScore >= 0.65) {
        adjustedScore += 0.02;
        boostReasons.push('category_relevance');
      }

      if (looseMatch && !exact) {
        suppressedBoostReasons.push("substring_match_rejected:no_token_boundary");
        if (matchResult.reason) {
          suppressedBoostReasons.push(matchResult.reason);
        }
      }

      adjustedScore = Math.min(1.0, adjustedScore);

      const symbolLowerForCanonical = s.symbol.trim().toLowerCase();
      const canonicalForInitial = canonicalAliasMap[symbolLowerForCanonical] || s.symbol;

      candidates.push({
        symbol: s.symbol,
        category: s.category,
        symbolValence: s.symbolValence,
        rawSimilarityScore,
        adjustedScore,
        retrievalMethods,
        lowConfidence: false,
        fallbackReason: null,
        interpretation: s.interpretation,
        boostReasons,
        suppressedBoostReasons,
        canonicalSymbol: canonicalForInitial,
        matchedVariants: [s.symbol],
        matchedTextVariant,
      });
    }
  }

  // Deduplicate candidates by normalized symbol key and merge aliases
  const uniqueCandidates = new Map<string, IRetrievedSymbol>();
  for (const c of candidates) {
    const symbolLower = c.symbol.trim().toLowerCase();
    const canonical = canonicalAliasMap[symbolLower] || c.symbol;
    const canonicalKey = canonical.trim().toLowerCase();

    const existing = uniqueCandidates.get(canonicalKey);
    if (!existing) {
      uniqueCandidates.set(canonicalKey, {
        ...c,
        symbol: canonical, // Use canonical symbol name
        canonicalSymbol: canonical,
        matchedVariants: [c.symbol],
        metadataFromVariant: c.symbol
      });
    } else {
      const existingVariant = existing.metadataFromVariant || existing.symbol;
      const preferNewMetadata = isMoreSpecific(c.symbol, existingVariant) 
        ? true 
        : (isMoreSpecific(existingVariant, c.symbol) ? false : (c.adjustedScore > existing.adjustedScore));

      const keepNewScore = c.adjustedScore > existing.adjustedScore;

      const mergedMethods = Array.from(new Set([...existing.retrievalMethods, ...c.retrievalMethods]));
      const mergedBoostReasons = Array.from(new Set([...existing.boostReasons, ...c.boostReasons]));
      const mergedSuppressed = Array.from(new Set([...existing.suppressedBoostReasons, ...c.suppressedBoostReasons]));
      const mergedVariants = Array.from(new Set([...existing.matchedVariants, c.symbol]));

      if (keepNewScore) {
        existing.adjustedScore = c.adjustedScore;
        existing.rawSimilarityScore = c.rawSimilarityScore;
        existing.lowConfidence = c.lowConfidence;
        existing.fallbackReason = c.fallbackReason;
        existing.matchedTextVariant = c.matchedTextVariant || existing.matchedTextVariant;
      }

      if (preferNewMetadata) {
        existing.category = c.category;
        existing.symbolValence = c.symbolValence;
        existing.interpretation = c.interpretation;
        existing.metadataFromVariant = c.symbol;
      }

      existing.retrievalMethods = mergedMethods;
      existing.boostReasons = mergedBoostReasons;
      existing.suppressedBoostReasons = mergedSuppressed;
      existing.matchedVariants = mergedVariants;
    }
  }
  const dedupedCandidates = Array.from(uniqueCandidates.values());

  // Sort candidates by adjusted score and retrievalMethod prioritization:
  // exact_match symbols always outrank vector-only symbols unless vector-only adjustedScore is at least 0.15 higher.
  dedupedCandidates.sort((a, b) => {
    const isExactA = a.retrievalMethods.includes('exact_match');
    const isExactB = b.retrievalMethods.includes('exact_match');

    if (isExactA && !isExactB) {
      if (b.adjustedScore >= a.adjustedScore + 0.15) {
        return 1; // B outranks A
      }
      return -1; // A outranks B
    }

    if (!isExactA && isExactB) {
      if (a.adjustedScore >= b.adjustedScore + 0.15) {
        return -1; // A outranks B
      }
      return 1; // B outranks A
    }

    if (Math.abs(b.adjustedScore - a.adjustedScore) > 1e-9) {
      return b.adjustedScore - a.adjustedScore;
    }

    const rawA = a.rawSimilarityScore ?? 0;
    const rawB = b.rawSimilarityScore ?? 0;
    return rawB - rawA;
  });

  // Filter out generic noise symbols based on conditions
  const cleanedCandidates = dedupedCandidates.filter((s) => {
    const isGeneric = genericStoplist.has(s.symbol.toLowerCase().trim());
    const isBoostEmpty = s.boostReasons.length === 0;
    const isSuppressedOrNoExactMatch = s.suppressedBoostReasons.length > 0 || !s.retrievalMethods.includes('exact_match');
    const isScoreBelow70 = s.adjustedScore < 0.70;

    if (isGeneric && isBoostEmpty && isSuppressedOrNoExactMatch && isScoreBelow70) {
      return false; // Remove candidate
    }
    return true;
  });

  // Vector similarity alone must be strong enough to name a symbol. Never pad
  // the result to an arbitrary minimum with unrelated dictionary entries.
  const reliableCandidates = cleanedCandidates.filter(s =>
    s.retrievalMethods.includes('exact_match')
    || s.boostReasons.length > 0
    || s.adjustedScore >= 0.70
  );

  // Filter using SYMBOL_RAG_MIN_SCORE
  const minScore = parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55');
  let finalSymbols = reliableCandidates.filter((s) =>
    s.retrievalMethods.includes('exact_match') || s.adjustedScore >= minScore
  );

  if (finalSymbols.length > 8) {
    finalSymbols = finalSymbols.slice(0, 8);
  }

  // Log counts and retrieval details
  logger.info('Hybrid RAG symbol retrieval completed', {
    extractedKeywordsCount: extractedKeywords.length,
    exactMatchCount,
    fullTextVectorResultCount: fullTextResultCount,
    phraseVectorResultCount: phraseVectorCount,
    finalRerankedSymbolCount: finalSymbols.length,
    retrievalStrategy: 'hybrid_rerank',
    vectorBackend,
  });

  return {
    symbols: finalSymbols,
    strategyUsed: 'hybrid_rerank',
    vectorBackend,
    extractedKeywords,
    rawText: segments.rawText,
    dreamNarrative: segments.dreamNarrative,
    wakingReactionText: segments.wakingReactionText,
    sleepContextText: segments.sleepContextText,
    segmentationReasons: segments.segmentationReasons,
  };
}
