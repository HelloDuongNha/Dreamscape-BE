import mongoose from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import UserDreamProfile from '../../../models/UserDreamProfile';
import Dream from '../../../models/Dream';
import { generateAnalysis, ILLMOutput } from '../../../../../infrastructure/llm.service';
import { retrieveSymbolsHybrid, IRetrievedSymbol } from '../retrieval/symbolRetrieval.service';
import { retrieveApprovedRuleV3 } from '../../../../rules_v3/services/ruleV3Retrieval.service';
import {
  canExplainPsychology,
  canGenerateContextQuestion,
} from '../../../../rules_v3/services/ruleV3DreamApplication.service';
import { retrieveSimilarDreams, SimilarDreamMatch } from '../retrieval/similarDreamRetrieval.service';
import {
  loadObservedSymbolPatterns,
  ObservedSymbolPattern,
} from '../retrieval/symbolObservation.service';
import {
  deduplicateAcademicSources,
  collectPersonalSymbolPatterns,
  extractContextualMotifHints,
  findNarrativeSentenceForSymbol,
  buildGroundedDreamTitle,
  attachRuleQuestionContext,
  polishGeneratedDreamProse,
  buildVerifiedScientificNote,
  collectScientificDreamEvidence,
  buildRuleScientificFallback,
  isGroundedDreamTitle,
  sanitizeGeneratedHypotheses,
  sanitizeInterpretiveThreads,
  buildGroundedMotifExplanation,
  sanitizeUnsupportedDreamClaims,
  ensureInterpretiveThreadCoverage,
  deriveDreamEmotionTone,
  removeInternalAnalysisVocabulary,
} from '../grounding/dreamAnalysisGrounding.service';
import { sanitizePracticalReflections } from '../assembly/practicalReflection.service';
import { buildDreamAnalysisPrompt } from '../prompts/dreamAnalysis.prompt';


// Interface for matched rules in audit trail
interface IAppliedRule {
  ruleId: string;
  group: string;
  factor: string;
  confidenceCap: number;
  claimStrength: string;
  applicationRole?: 'psychological_mechanism' | 'contextual_probe' | 'descriptive_pattern';
  applicationTier?: 'supported' | 'exploratory';
  evidenceScore?: number;
  supportingSourceCount?: number;
}

// Interface for retrieved symbols in audit trail
interface IUsedSymbol {
  symbol: string;
  category: string;
  symbolValence: number;
  rawSimilarityScore: number | null;
  adjustedScore: number;
  retrievalMethods: string[];
  lowConfidence: boolean;
  fallbackReason: string | null;
  interpretation?: string; // Included for LLM compaction, though stored structured
  boostReasons: string[];
  suppressedBoostReasons: string[];
  canonicalSymbol: string;
  matchedVariants: string[];
  matchedTextVariant?: string;
}

function normalizePunctuation(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/。/g, '.')
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
    .replace(/！/g, '!')
    .replace(/？/g, '?');
}

function normalizeObjectPunctuation(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return normalizePunctuation(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeObjectPunctuation(item));
  }
  if (typeof obj === 'object') {
    const copy: any = {};
    for (const key of Object.keys(obj)) {
      copy[key] = normalizeObjectPunctuation(obj[key]);
    }
    return copy;
  }
  return obj;
}

interface IAnalysisResult {
  aiAnalysis: ILLMOutput;
  analysisEmbedding: number[];
  retrievedContext: {
    componentA: {
      rawText: string;
      dreamNarrative: string;
      wakingReactionText: string;
      sleepContextText: string;
      sleepContext: Record<string, any>;
      segmentationReasons: string[];
      usedSymbols: IUsedSymbol[];
      retrievalConfig: {
        topK: number;
        minSimilarityScore: number;
        embeddingModel: string;
        retrievalStrategy: string;
        vectorBackend: string;
      };
    };
    componentB: {
      usedProfileFields: {
        culturalProfileUsed: boolean;
        measuredPsychologicalProfileUsed: boolean;
        learnedPersonalPatternUsed: boolean;
      };
    };
    componentC: {
      similarDreams: SimilarDreamMatch[];
      personalSymbolPatterns: Array<{ symbol: string; occurrences: number; recentMeaning: string }>;
      observedSymbolPatterns: ObservedSymbolPattern[];
    };
    componentD: {
      appliedRules: IAppliedRule[];
      evidenceLinks?: {
        ruleId: string;
        evidenceRole: string;
        sourceId: mongoose.Types.ObjectId;
        sourceTitle: string;
        sourceYear: number | null;
        doi: string | null;
        chunkIds: mongoose.Types.ObjectId[];
        chunkPreview: string;
      }[];
    };
  };
  strategyUsed: 'hybrid_rerank';
}

export type DreamAnalysisStage = 'preparing' | 'retrieving_context' | 'retrieving_rules' | 'generating_analysis' | 'finalizing';
export interface DreamAnalysisProgress {
  stage: DreamAnalysisStage;
  progress: number;
  message: string;
  miniStep?: string;
  resultSummary?: string;
}

/**
 * Safely resolves nested property paths from an object.
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Rule matcher supporting nested paths, operator comparisons, and dependency guards.
 */
/**
 * Main Analysis Orchestration Pipeline.
 * Performs RAG on Symbol Dictionary and Knowledge Rules, calls Ollama, and constructs audit trails.
 */
export async function runDreamAnalysis(
  userId: string,
  dreamText: string,
  sleepContext: Record<string, any>,
  onProgress?: (progress: DreamAnalysisProgress) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<IAnalysisResult> {
  const throwIfCancelled = () => {
    if (abortSignal?.aborted) {
      const error = new Error('dream_analysis_cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };
  const report = async (
    stage: DreamAnalysisStage,
    progress: number,
    message: string,
    miniStep?: string,
    resultSummary?: string,
  ) => {
    throwIfCancelled();
    await onProgress?.({ stage, progress, message, miniStep, resultSummary });
  };
  throwIfCancelled();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not initialized');
  }

  await report('preparing', 8, 'Đang chuẩn bị hồ sơ và ngữ cảnh phân tích...', 'Đang đọc hồ sơ và tách phần lời kể cần phân tích.');
  // ─── STEP 1: Retrieve User Profile (Component B) ───
  const userProfile = await UserDreamProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();

  const defaultProfile = {
    basicProfile: { fullName: '', gender: 'unknown', birthDate: '', birthHour: '', birthTimeUnknown: true },
    culturalProfile: {
      zodiac: { sign: 'unknown', viName: 'Chưa rõ', element: 'unknown', tags: [] },
      lifePath: { number: 0, keywords: [] },
      horaryHour: { branch: 'unknown' },
    },
    measuredPsychologicalProfile: {
      bigFive: { enabled: false, source: null, openness: null, conscientiousness: null, extraversion: null, agreeableness: null, neuroticism: null },
      chronotype: { enabled: false, source: null, type: null },
      schemas: { enabled: false, source: null, detectedSchemas: [] },
    },
    learnedPersonalPattern: { totalDreams: 0, commonSymbols: [], commonThemes: [], commonEmotions: [], averageDreamScore: null },
    preferences: { allowCulturalAnalysis: true, allowFingerprintAnalysis: false, allowPsychologicalPersonalization: false, allowCommunitySimilarity: false },
  };

  const profileData = {
    ...defaultProfile,
    ...userProfile,
    basicProfile: { ...defaultProfile.basicProfile, ...userProfile?.basicProfile },
    culturalProfile: { ...defaultProfile.culturalProfile, ...userProfile?.culturalProfile },
    measuredPsychologicalProfile: {
      ...defaultProfile.measuredPsychologicalProfile,
      ...userProfile?.measuredPsychologicalProfile,
      bigFive: { ...defaultProfile.measuredPsychologicalProfile.bigFive, ...userProfile?.measuredPsychologicalProfile?.bigFive },
      chronotype: { ...defaultProfile.measuredPsychologicalProfile.chronotype, ...userProfile?.measuredPsychologicalProfile?.chronotype },
      schemas: { ...defaultProfile.measuredPsychologicalProfile.schemas, ...userProfile?.measuredPsychologicalProfile?.schemas }
    },
    learnedPersonalPattern: { ...defaultProfile.learnedPersonalPattern, ...userProfile?.learnedPersonalPattern },
    preferences: { ...defaultProfile.preferences, ...userProfile?.preferences }
  };

  await report(
    'preparing',
    18,
    'Đã chuẩn bị xong đầu vào phân tích.',
    'Đã tách lời kể khỏi thông tin khi thức và nạp các tùy chọn cá nhân được cho phép.',
    'Đã nạp hồ sơ và các lựa chọn cá nhân hóa được người dùng cho phép.',
  );

  await report('retrieving_context', 20, 'Đang nhận diện chi tiết và tìm các giấc mơ tương đồng...', 'Đang đối chiếu từ điển, mô-típ theo ngữ cảnh và lịch sử giấc mơ.');
  // ─── STEP 2: Hybrid Search (Component A) ───
  const minScore = parseFloat(process.env.SYMBOL_RAG_MIN_SCORE || '0.55');
  const embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

  const { 
    symbols: retrievedSymbols, 
    strategyUsed, 
    vectorBackend,
    rawText,
    dreamNarrative,
    wakingReactionText,
    sleepContextText,
    segmentationReasons
  } = await retrieveSymbolsHybrid(dreamText);

  // Sleep context is accepted only from structured input. Free-form dream text
  // remains intact instead of being classified through a finite phrase list.
  const enrichedSleepContext = { ...(sleepContext || {}) };
  const similarDreamResult = await retrieveSimilarDreams(userId, dreamNarrative, 4);
  const recentDreamRows = await Dream.find({
    userId: new mongoose.Types.ObjectId(userId),
    ai_status: 'completed',
  })
    .select('ai_result.symbolic_notes')
    .sort({ created_at: -1 })
    .limit(30)
    .lean();
  const personalSymbolPatterns = collectPersonalSymbolPatterns(recentDreamRows, dreamNarrative);
  const contextualMotifHints = extractContextualMotifHints(dreamNarrative);
  let observedSymbolPatterns: ObservedSymbolPattern[] = [];
  try {
    observedSymbolPatterns = await loadObservedSymbolPatterns(
      [
        ...contextualMotifHints,
        ...retrievedSymbols.flatMap(symbol => [symbol.symbol, symbol.canonicalSymbol, symbol.matchedTextVariant || '']),
      ],
      new mongoose.Types.ObjectId(userId),
    );
  } catch (error) {
    logger.warn('Observed symbol index unavailable; continuing with dictionary and personal history.', {
      error: String(error),
    });
  }

  await report(
    'retrieving_context',
    34,
    'Đã nhận diện xong các chi tiết và trường hợp tương đồng.',
    'Đang chuyển các kết quả phù hợp sang bước kiểm tra tri thức.',
    `Nhận diện ${retrievedSymbols.length} mục từ điển, ${contextualMotifHints.length} chi tiết theo ngữ cảnh, ${observedSymbolPatterns.length} mẫu trong kho quan sát, ${similarDreamResult.matches.length} giấc mơ tương đồng, ${personalSymbolPatterns.length} mô-típ cá nhân lặp lại và ${Object.keys(enrichedSleepContext).length} dữ kiện về điều kiện ngủ.`,
  );

  await report('retrieving_rules', 38, 'Đang chọn lập luận phù hợp và kiểm tra dẫn chứng...', 'Đang lọc kết luận mô tả, câu hỏi kiểm tra và cơ chế tâm lý.');
  // ─── STEP 3: Rule V3 Evaluation (Component D) ───
  // Rule V3 is the only production knowledge source. When no approved V3 rule
  // matches, Oracle continues without making an academic rule claim.
  let matchedRules: any[] = [];
  let prefetchedV3EvidenceLinks: any[] = [];
  try {
    const v3 = await retrieveApprovedRuleV3(dreamNarrative, 10);
    matchedRules = v3.rules;
    prefetchedV3EvidenceLinks = v3.evidenceLinks;
  } catch (err: any) {
    logger.warn('Rule V3 retrieval failed; continuing without academic rule claims.', { error: String(err) });
  }

  // A matched academic statement is not automatically a psychological
  // explanation. Descriptive findings may remain in the audit trail, contextual
  // findings may support a question, and only mechanism rules may support an
  // explanatory scientific note.
  const explanatoryRules = matchedRules.filter(canExplainPsychology);
  const questionRules = matchedRules.filter(canGenerateContextQuestion);
  const llmUsableRules = matchedRules.filter(rule => rule.applicationRole !== 'descriptive_pattern');

  // Rule V3 retrieval owns its exact verified evidence links.
  const validEvidenceLinks: any[] = prefetchedV3EvidenceLinks;

  // Group evidence by rule ID
  const linksByRule = new Map<string, any[]>();
  for (const link of validEvidenceLinks) {
    const rId = link.ruleId.toString();
    if (!linksByRule.has(rId)) {
      linksByRule.set(rId, []);
    }
    linksByRule.get(rId)!.push(link);
  }

  // Build prompt segments and audit trail
  const evidenceLinksAudit: any[] = [];
  let promptEvidenceText = '';
  let totalEvidenceChars = 0;
  const maxTotalEvidenceChars = 5000;
  const validSourcesMap = new Map<string, any[]>();
  const validEvidenceMap = new Map<string, Array<{
    sourceId: string;
    chunkId: string;
    quote: string;
  }>>();

  for (const r of llmUsableRules) {
    const links = linksByRule.get(r._id.toString()) || [];
    if (links.length === 0) continue;

    // Limit to max 2 evidence links per rule
    const ruleLinks = links.slice(0, 2);
    let ruleText = '';
    let ruleSourcesList: any[] = [];

    for (const link of ruleLinks) {
      const src = link.chunkId.sourceId;
      const chunk = link.chunkId;

      ruleSourcesList.push({
        sourceId: src._id.toString(),
        title: src.title,
        authors: Array.isArray(src.authors) ? src.authors : [src.authors],
        year: src.year,
        journal: src.journal || src.publisher,
        doi: src.doi,
        chunkIds: [chunk._id.toString()]
      });

      const snippet = link.quote || chunk.text || '';
      ruleText += (ruleText ? '\n' : '') + snippet;

      evidenceLinksAudit.push({
        ruleId: r._id,
        evidenceRole: 'primary_support',
        sourceId: src._id,
        sourceTitle: src.title,
        sourceYear: src.year,
        doi: src.doi,
        chunkIds: [chunk._id],
        chunkPreview: snippet.substring(0, 400) + (snippet.length > 400 ? '...' : '')
      });
    }

    ruleSourcesList = deduplicateAcademicSources(ruleSourcesList);
    validEvidenceMap.set(String(r.ruleId || r._id), ruleLinks.map(link => ({
      sourceId: String(link.chunkId.sourceId._id),
      chunkId: String(link.chunkId._id),
      quote: String(link.quote || '').trim(),
    })).filter(item => item.quote));

    if (ruleText.trim()) {
      const remainingGlobalChars = maxTotalEvidenceChars - totalEvidenceChars;
      if (remainingGlobalChars > 0) {
        const truncatedRuleText = ruleText.substring(0, remainingGlobalChars);
        totalEvidenceChars += truncatedRuleText.length;

        validSourcesMap.set(r._id.toString(), ruleSourcesList);

        const authorsStr = ruleSourcesList.map(s => {
          const auths = s.authors || [];
          if (auths.length === 0) return 'N/A';
          if (auths.length <= 2) return auths.join(', ');
          return `${auths[0]} et al.`;
        }).join('; ');
        const yearsStr = ruleSourcesList.map(s => s.year || 'N/A').join('; ');
        const titlesStr = ruleSourcesList.map(s => s.title).join('; ');
        const doisStr = ruleSourcesList.map(s => s.doi || 'N/A').join('; ');

        promptEvidenceText += `
RuleId: ${String(r.ruleId || r._id)}
RuleCode: ${r.ruleCode}
RuleStatement: ${r.ruleStatement}
Source: ${authorsStr} (${yearsStr}), "${titlesStr}", DOI: ${doisStr}
Evidence Summary: ${ruleLinks.map(l => l.evidenceSummary).join('; ')}
Evidence Quote:
${truncatedRuleText.split('\n').map(line => `- "${line}"`).join('\n')}
`;
      }
    }
  }

  await report(
    'retrieving_rules',
    48,
    'Đã kiểm tra xong phần tri thức có thể dùng.',
    'Đang đóng gói phần dữ liệu đã kiểm chứng để viết kết quả.',
    `Tìm thấy ${matchedRules.length} kết luận liên quan; ${explanatoryRules.length} kết luận có thể hỗ trợ giải thích tâm lý và ${questionRules.length} kết luận có điều kiện có thể kiểm tra. Số câu hỏi cuối cùng còn phụ thuộc chi tiết thật sự xuất hiện trong lời kể; ${validEvidenceLinks.length} liên kết dẫn chứng đã được kiểm tra.`,
  );

  const promptEvidenceSection = promptEvidenceText.trim()
    ? `\n[Component D Academic Evidence]\nFor each matching rule below: Use the rule definition and the provided academic evidence together. Do not introduce claims beyond the rule and evidence.\n${promptEvidenceText.trim()}\n`
    : '';

  // ─── STEP 4: Prompt Compaction ───
  const promptSymbolsCandidates = retrievedSymbols.filter(s => 
    s.retrievalMethods.includes('exact_match') ||
    (s.boostReasons && s.boostReasons.length > 0) ||
    s.adjustedScore >= 0.85
  );

  promptSymbolsCandidates.sort((a, b) => {
    // 1. exact_match first
    const aExact = a.retrievalMethods.includes('exact_match') ? 1 : 0;
    const bExact = b.retrievalMethods.includes('exact_match') ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    // 2. symbols with boostReasons first
    const aBoost = a.boostReasons && a.boostReasons.length > 0 ? 1 : 0;
    const bBoost = b.boostReasons && b.boostReasons.length > 0 ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;

    // 3. adjustedScore >= 0.85 preferred
    const aPref = a.adjustedScore >= 0.85 ? 1 : 0;
    const bPref = b.adjustedScore >= 0.85 ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;

    // 4. adjustedScore descending
    return b.adjustedScore - a.adjustedScore;
  });

  const promptSymbols = promptSymbolsCandidates.slice(0, 5);

  const compactSymbolsText = promptSymbols
    .map(
      (s) =>
        `- Symbol: "${s.symbol}" (Category: "${s.category}", Valence: ${s.symbolValence}, Relevance/Similarity: ${s.rawSimilarityScore !== null ? s.rawSimilarityScore.toFixed(3) : 'Exact-Match-Only'}, Adjusted Score: ${s.adjustedScore.toFixed(3)})\n  Dictionary Meaning: ${s.interpretation}`
    )
    .join('\n');

  const compactRulesText = llmUsableRules
    .map(
      (r) =>
        `- RuleId: "${String(r.ruleId || r._id)}", ApplicationRole: "${r.applicationRole}", ApplicationTier: "${r.applicationTier || 'supported'}", RuleCode: "${r.ruleCode}" (Statement: "${r.ruleStatement}", Basis: "${r.scientificBasis}", Classifications: "${r.classifications.join(', ')}", Unified argument score: ${r.evidenceScore ?? 0}/100)`
    )
    .join('\n');

  const basicProfile = profileData.basicProfile || {};
  const bigFive = profileData.measuredPsychologicalProfile.bigFive || {};
  const chronotype = profileData.measuredPsychologicalProfile.chronotype || {};
  const schemas = profileData.measuredPsychologicalProfile.schemas || {};
  const hasBirthProfile = !!(
    (profileData.basicProfile?.birthDate && profileData.basicProfile.birthDate.trim() !== '') ||
    (profileData.culturalProfile?.zodiac?.sign && profileData.culturalProfile.zodiac.sign !== 'unknown') ||
    (profileData.culturalProfile?.lifePath?.number && profileData.culturalProfile.lifePath.number !== 0) ||
    (profileData.culturalProfile?.horaryHour?.branch && profileData.culturalProfile.horaryHour.branch !== 'unknown')
  );
  // Birth data is a user parameter, not an evidence source. Cultural interpretation
  // remains disabled until a curated, citable cultural knowledge collection exists.
  const culturalEvidenceAvailable = false;
  const culturalProfileUsed = profileData.preferences?.allowCulturalAnalysis === true
    && hasBirthProfile
    && culturalEvidenceAvailable;
  const culturalProfileText = culturalProfileUsed
    ? `Zodiac: ${profileData.culturalProfile.zodiac.viName} (Sign: ${profileData.culturalProfile.zodiac.sign}, Element: ${profileData.culturalProfile.zodiac.element}, Tags: ${profileData.culturalProfile.zodiac.tags.join(', ')}), Life Path: ${profileData.culturalProfile.lifePath.number} (Keywords: ${profileData.culturalProfile.lifePath.keywords.join(', ')}), Horary Hour: ${profileData.culturalProfile.horaryHour.branch}`
    : 'Unavailable or not allowed; do not generate cultural claims';

  const profileText = `
User Profile Context:
- Full Name: ${basicProfile.fullName || 'Anonymous'}
- Gender: ${basicProfile.gender || 'unknown'}
- Cultural Parameters: ${culturalProfileText}
- Measured Personality: ${
    bigFive.enabled
      ? `Big Five Profile [Openness: ${bigFive.openness}, Conscientiousness: ${bigFive.conscientiousness}, Extraversion: ${bigFive.extraversion}, Agreeableness: ${bigFive.agreeableness}, Neuroticism: ${bigFive.neuroticism}]`
      : 'Disabled/Not measured'
  }
- Chronotype: ${chronotype.enabled ? chronotype.type : 'Disabled/Not measured'}
- Core Schemas: ${schemas.enabled ? schemas.detectedSchemas.join(', ') : 'Disabled/Not measured'}
`;

  const personalPatternText = personalSymbolPatterns.length > 0
    ? personalSymbolPatterns.map(pattern =>
      `- "${pattern.symbol}" appeared in ${pattern.occurrences} prior dream(s). Recent case-specific interpretation: ${pattern.recentMeaning}`
    ).join('\n')
    : 'None matched the current narrative';

  const observedSymbolText = observedSymbolPatterns.length > 0
    ? observedSymbolPatterns.map(pattern =>
      `- ${pattern.matchedLabels[0] || pattern.symbolKey}: ${pattern.personalDreamCount} prior personal occurrence(s), ${pattern.publicDreamCount} public occurrence(s); contextual tones ${JSON.stringify(pattern.toneCounts)}`
    ).join('\n')
    : 'None matched the current narrative';

  const similarDreamText = similarDreamResult.matches.length > 0
    ? similarDreamResult.matches.map((item, index) => `
PriorDream ${index + 1}:
- Similarity: ${item.similarity}%
- Same author: ${item.sameAuthor ? 'yes' : 'no'}
- Matching signals: ${item.matchedOn.join(', ')}
- Dream excerpt: ${item.excerpt}
- Earlier analysis summary: ${item.priorAnalysisSummary || 'Unavailable'}
- First-person confirmations from that dream: ${item.confirmedContext?.length ? item.confirmedContext.map(entry => `${entry.answer.toUpperCase()}: ${entry.question} — ${entry.interpretation}`).join(' | ') : 'None'}
- Context later added by that dream's author: ${item.ownerContextComments?.length ? item.ownerContextComments.join(' | ') : 'None'}
`).join('\n')
    : 'None found';

  const compactedPrompt = buildDreamAnalysisPrompt({
    dreamNarrative,
    wakingContext: wakingReactionText,
    sleepContext: enrichedSleepContext,
    profileContext: profileText,
    evidenceContext: promptEvidenceSection,
    ruleContext: compactRulesText,
    dictionaryContext: compactSymbolsText,
    personalSymbolContext: personalPatternText,
    observedSymbolContext: observedSymbolText,
    similarDreamContext: similarDreamText,
    contextualMotifs: contextualMotifHints,
    culturalAnalysisAllowed: culturalProfileUsed,
  });

  // ─── STEP 5: LLM Generation ───
  // One bounded generation pass. Structural gaps are completed by deterministic
  // rule-grounded fallbacks below; re-sending the entire answer to a local model
  // doubled latency and could introduce a different interpretation.
  await report(
    'generating_analysis',
    55,
    'Mô hình đang tổng hợp các mạch diễn giải có căn cứ...',
    'Đang nối chuỗi sự kiện, cảm xúc, trường hợp tương đồng và phần tri thức đã kiểm chứng.',
  );
  let rawAiAnalysis: ILLMOutput;
  try {
    rawAiAnalysis = await generateAnalysis(compactedPrompt, abortSignal);
    rawAiAnalysis.analysis_mode = 'llm_grounded';
  } catch (error) {
    logger.warn('Dream analysis generation failed; no synthetic case-specific answer was created.', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await report(
    'generating_analysis',
    82,
    'Đã nhận xong bản tổng hợp ban đầu.',
    'Đang chuyển sang kiểm tra từng nhận định trước khi hiển thị.',
    'Đã nhận bản tổng hợp có cấu trúc; chưa hiển thị cho tới khi hoàn tất kiểm tra nguồn và phạm vi suy luận.',
  );
  await report(
    'finalizing',
    88,
    'Đang kiểm tra câu hỏi, nguồn và loại bỏ suy luận không có căn cứ...',
    'Đang đối chiếu chi tiết với lời kể, gắn nguồn và bỏ các kết luận vượt quá bằng chứng.',
  );
  const aiAnalysis = normalizeObjectPunctuation(rawAiAnalysis);

  // Keep only dictionary symbols or contextual motifs grounded verbatim in the dream narrative.
  if (aiAnalysis && Array.isArray(aiAnalysis.symbolic_notes)) {
    const groundedSymbols: any[] = [];
    const seenSymbols = new Set<string>();
    for (const note of aiAnalysis.symbolic_notes) {
      const noteSymLower = (note.symbol || '').trim().toLowerCase();
      const matchedSym = retrievedSymbols.find(s => {
        const symLower = s.symbol.toLowerCase().trim();
        const canonLower = (s.canonicalSymbol || '').toLowerCase().trim();
        return symLower === noteSymLower || canonLower === noteSymLower || s.matchedVariants?.some(v => v.toLowerCase().trim() === noteSymLower);
      });
      if (matchedSym) {
        note.symbolValence = matchedSym.symbolValence;
        note.symbol = matchedSym.matchedTextVariant || matchedSym.symbol;
        note.origin = 'dictionary';
        note.dreamEvidence = findNarrativeSentenceForSymbol(
          matchedSym.matchedTextVariant
            || matchedSym.matchedVariants?.find(v => findNarrativeSentenceForSymbol(v, dreamNarrative))
            || matchedSym.symbol,
          dreamNarrative,
        );
      } else {
        const contextualEvidence = findNarrativeSentenceForSymbol(note.symbol, dreamNarrative);
        if (!contextualEvidence) continue;
        note.origin = 'contextual_observation';
        note.dreamEvidence = contextualEvidence;
        note.relevance = Math.min(0.75, Math.max(0, Number(note.relevance) || 0));
        note.symbolValence = Math.max(-1, Math.min(1, Number(note.symbolValence) || 0));
      }
      note.contextualTone = note.contextualTone || 'neutral';
      note.meaning = buildGroundedMotifExplanation(note, matchedRules);
      const key = String(note.symbol || '').trim().toLocaleLowerCase('vi');
      if (!key || seenSymbols.has(key)) continue;
      seenSymbols.add(key);
      groundedSymbols.push(note);
    }
    aiAnalysis.symbolic_notes = groundedSymbols.slice(0, 8);
  }

  // Titles are decorative, but fabricated concrete nouns damage trust. Replace
  // any ungrounded title with one built only from motifs verified in the dream.
  if (aiAnalysis && !isGroundedDreamTitle(aiAnalysis.title, dreamNarrative)) {
    aiAnalysis.title = buildGroundedDreamTitle(
      dreamNarrative,
      (aiAnalysis.symbolic_notes || []).map((note: any) => note.symbol),
    );
  }

  // Post-process scientific_context_notes to own citations, validate rules, and normalize confidence
  if (aiAnalysis) {
    if (explanatoryRules.length === 0) {
      aiAnalysis.scientific_context_notes = [];
    } else if (Array.isArray(aiAnalysis.scientific_context_notes)) {
      const validRuleIds = new Set(explanatoryRules.map(r => String(r.ruleId || r._id)));
      const finalNotes: any[] = [];
      const seenScientificRuleIds = new Set<string>();

      for (const note of aiAnalysis.scientific_context_notes) {
        const cleanRuleId = (note.ruleId || '').trim();
        
        // Note-rule validation: keep only notes with ruleId matching appliedRules
        if (!validRuleIds.has(cleanRuleId)) {
          logger.warn(`Discarding scientific_context_note with unknown ruleId: "${cleanRuleId}"`);
          continue;
        }
        if (seenScientificRuleIds.has(cleanRuleId)) continue;

        const matchedRule = explanatoryRules.find(r => String(r.ruleId || r._id) === cleanRuleId);
        const confidenceCap = matchedRule ? matchedRule.confidenceCap : 1.0;

        // Academic confidence is backend-owned by the verified rule evidence score.
        const normalizedConfidence = Math.min(1, Math.max(0, Number(confidenceCap) || 0));

        // Handle sources: backend owns citations
        let finalSources: any[] = [];
        const preRetrievedSources = validSourcesMap.get(cleanRuleId) || [];

        if (Array.isArray(note.sources) && note.sources.length > 0) {
          // Filter sources strictly to prevent hallucinated citations
          const preRetrievedSourceIds = new Set(preRetrievedSources.map(s => s.sourceId));
          const filteredSources = note.sources.filter((src: any) => src && preRetrievedSourceIds.has(src.sourceId));
          
          finalSources = filteredSources.map((src: any) => {
            const original = preRetrievedSources.find(s => s.sourceId === src.sourceId);
            return original || src;
          });

          if (finalSources.length === 0 && preRetrievedSources.length > 0) {
            finalSources = preRetrievedSources;
          }
        } else {
          if (preRetrievedSources.length > 0) {
            finalSources = preRetrievedSources;
          }
        }

        finalSources = deduplicateAcademicSources(finalSources);
        const scientificText = String(note.note || '').trim();
        const sentenceCount = scientificText.split(/(?<=[.!?])\s+/).filter(Boolean).length;
        if (finalSources.length === 0 || sentenceCount < 2) {
          logger.warn('Discarding scientific note without a citable source or sufficient explanation.', {
            ruleId: cleanRuleId,
            sourceCount: finalSources.length,
            sentenceCount,
          });
          continue;
        }
        const verifiedNote = buildVerifiedScientificNote({
          rule: matchedRule,
          noteText: scientificText,
          narrative: dreamNarrative,
          dreamEvidence: note.dreamEvidence,
          sources: finalSources,
          evidenceQuotes: validEvidenceMap.get(cleanRuleId) || [],
          confidence: normalizedConfidence,
        });
        if (!verifiedNote) continue;
        seenScientificRuleIds.add(cleanRuleId);
        finalNotes.push(verifiedNote);
      }

      for (const matchedRule of explanatoryRules) {
        const ruleId = String(matchedRule.ruleId || matchedRule._id);
        if (seenScientificRuleIds.has(ruleId) || finalNotes.length >= 4) continue;
        const fallbackText = buildRuleScientificFallback(matchedRule, dreamNarrative);
        const sources = deduplicateAcademicSources(validSourcesMap.get(ruleId) || []);
        if (!fallbackText || sources.length === 0) continue;
        const verifiedNote = buildVerifiedScientificNote({
          rule: matchedRule,
          noteText: fallbackText,
          narrative: dreamNarrative,
          sources,
          evidenceQuotes: validEvidenceMap.get(ruleId) || [],
          confidence: Number(matchedRule.confidenceCap) || 0,
        });
        if (!verifiedNote) continue;
        seenScientificRuleIds.add(ruleId);
        finalNotes.push(verifiedNote);
      }

      aiAnalysis.scientific_context_notes = finalNotes;
    }
    if (!culturalProfileUsed) {
      aiAnalysis.cultural_symbolic_notes = [];
    }
    if (Array.isArray(aiAnalysis.real_life_hypotheses)) {
      const validRuleIds = new Set(questionRules.map(rule => String(rule.ruleId || rule._id)));
      const generatedHypotheses = sanitizeGeneratedHypotheses(
        aiAnalysis.real_life_hypotheses,
        dreamNarrative,
        wakingReactionText,
        validRuleIds,
      );
      const mergedQuestions = new Map<string, any>();
      for (const item of generatedHypotheses) {
        const key = String(item.verificationKey || `${item.ruleId}:${item.followUpQuestion}`);
        if (!mergedQuestions.has(key)) mergedQuestions.set(key, item);
      }
      aiAnalysis.real_life_hypotheses = [...mergedQuestions.values()].slice(0, 4);
      aiAnalysis.real_life_hypotheses = attachRuleQuestionContext(
        aiAnalysis.real_life_hypotheses,
        questionRules,
      );
      aiAnalysis.real_life_hypotheses = aiAnalysis.real_life_hypotheses.map((item: any) => {
        const ruleId = String(item.ruleId || '');
        const validationEvidence = (validEvidenceMap.get(ruleId) || [])[0];
        return {
          ...item,
          sources: deduplicateAcademicSources(validSourcesMap.get(ruleId) || []),
          ...(validationEvidence ? {
            validationSourceId: validationEvidence.sourceId,
            validationExactQuote: validationEvidence.quote,
          } : {}),
        };
      });
      aiAnalysis.scientific_context_notes = (aiAnalysis.scientific_context_notes || []).map((note: any) => {
        const linkedEvidence = (aiAnalysis.real_life_hypotheses || [])
          .filter((item: any) => String(item?.ruleId || '') === String(note?.ruleId || ''))
          .flatMap((item: any) => item.evidenceFromDream || []);
        return {
          ...note,
          matchedDreamDetails: collectScientificDreamEvidence(
            { note: note.note, dreamEvidence: note.matchedDreamDetails },
            dreamNarrative,
            linkedEvidence,
          ),
        };
      });
    }
    aiAnalysis.interpretive_threads = sanitizeInterpretiveThreads(
      aiAnalysis.interpretive_threads || [],
      dreamNarrative,
    ).map((thread: any) => ({
      ...thread,
      reasoning: polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(thread.reasoning)),
      alternativeExplanation: polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(thread.alternativeExplanation)),
    }));
    aiAnalysis.interpretive_threads = ensureInterpretiveThreadCoverage(
      dreamNarrative,
      aiAnalysis.interpretive_threads,
    ).map((thread: any) => ({
      ...thread,
      title: removeInternalAnalysisVocabulary(thread.title),
      reasoning: removeInternalAnalysisVocabulary(thread.reasoning),
      alternativeExplanation: removeInternalAnalysisVocabulary(thread.alternativeExplanation),
    }));
    aiAnalysis.practical_reflections = (aiAnalysis.practical_reflections || [])
      .map((item: any) => ({
        suggestion: String(item?.suggestion || '').trim(),
        rationale: String(item?.rationale || '').trim(),
      }))
      .filter((item: any) => item.suggestion.length >= 30 && item.rationale.length >= 40)
      .slice(0, 3);
    aiAnalysis.practical_reflections = sanitizePracticalReflections(
      aiAnalysis.practical_reflections,
    );
    aiAnalysis.summary = polishGeneratedDreamProse(aiAnalysis.summary);
    aiAnalysis.core_analysis = polishGeneratedDreamProse(
      sanitizeUnsupportedDreamClaims(aiAnalysis.core_analysis),
    );
    if (!aiAnalysis.emotional_tone_key || !aiAnalysis.emotional_tone) {
      const emotion = deriveDreamEmotionTone(dreamNarrative);
      aiAnalysis.emotional_tone_key = emotion.key;
      aiAnalysis.emotional_tone = emotion.label;
    }
    aiAnalysis.summary = removeInternalAnalysisVocabulary(aiAnalysis.summary);
    aiAnalysis.core_analysis = removeInternalAnalysisVocabulary(aiAnalysis.core_analysis);
  }

  if (aiAnalysis) {
    aiAnalysis.similar_dreams = similarDreamResult.matches.map(item => ({
      dreamId: item.dreamId,
      title: item.title,
      excerpt: item.excerpt,
      createdAt: item.createdAt,
      authorDisplayName: item.authorDisplayName,
      sameAuthor: item.sameAuthor,
      similarity: item.similarity,
      matchedOn: item.matchedOn,
    }));
    const creative = aiAnalysis.creative_continuation;
    if (creative
      && typeof creative.title === 'string'
      && typeof creative.continuation === 'string'
      && typeof creative.connectionToCurrentDream === 'string') {
      const inspirationIndexes: number[] = Array.isArray(creative.inspirationIndexes)
        ? [...new Set<number>((creative.inspirationIndexes as unknown[])
          .filter((index): index is number => Number.isInteger(index) && Number(index) >= 1 && Number(index) <= similarDreamResult.matches.length))]
        : [];
      creative.inspirations = inspirationIndexes.map(index => {
        const item = similarDreamResult.matches[index - 1];
        return {
          dreamId: item.dreamId,
          title: item.title,
          similarity: item.similarity,
          matchedOn: item.matchedOn,
        };
      });
      creative.inspirationIndexes = inspirationIndexes;
      creative.disclaimer = 'Đây là một đoạn sáng tác tham khảo dựa trên mô-típ kể chuyện, không phải dự báo về giấc mơ tiếp theo và không phải kết luận tâm lý.';
    } else {
      delete aiAnalysis.creative_continuation;
    }
  }

  // ─── STEP 6: Construct Audit Trail ───
  const measuredPsychologicalProfileUsed =
    profileData.measuredPsychologicalProfile.bigFive.enabled === true ||
    profileData.measuredPsychologicalProfile.chronotype.enabled === true ||
    profileData.measuredPsychologicalProfile.schemas.enabled === true;

  // Clean retrieved symbols to exclude the interpretation text in audit trail
  const cleanUsedSymbols = retrievedSymbols.map((s) => ({
    symbol: s.symbol,
    category: s.category,
    symbolValence: s.symbolValence,
    rawSimilarityScore: s.rawSimilarityScore,
    adjustedScore: s.adjustedScore,
    retrievalMethods: s.retrievalMethods,
    lowConfidence: s.lowConfidence,
    fallbackReason: s.fallbackReason,
    boostReasons: s.boostReasons,
    suppressedBoostReasons: s.suppressedBoostReasons,
    canonicalSymbol: s.canonicalSymbol,
    matchedVariants: s.matchedVariants,
    matchedTextVariant: s.matchedTextVariant,
  }));

  await report(
    'finalizing',
    96,
    'Đang hoàn tất kết quả phân tích...',
    'Đang lưu bản phân tích và dấu vết dữ liệu đã sử dụng.',
    `Giữ lại ${aiAnalysis.symbolic_notes?.length || 0} chi tiết nổi bật, ${aiAnalysis.scientific_context_notes?.length || 0} giải thích có nguồn, ${aiAnalysis.real_life_hypotheses?.length || 0} câu hỏi làm rõ và ${aiAnalysis.similar_dreams?.length || 0} giấc mơ tương đồng.`,
  );
  return {
    aiAnalysis,
    analysisEmbedding: similarDreamResult.queryEmbedding,
    retrievedContext: {
      componentA: {
        rawText,
        dreamNarrative,
        wakingReactionText,
        sleepContextText,
        sleepContext: enrichedSleepContext,
        segmentationReasons,
        usedSymbols: cleanUsedSymbols,
        retrievalConfig: {
          topK: cleanUsedSymbols.length,
          minSimilarityScore: minScore,
          embeddingModel: embedModel,
          retrievalStrategy: strategyUsed,
          vectorBackend,
        },
      },
      componentB: {
        usedProfileFields: {
          culturalProfileUsed,
          measuredPsychologicalProfileUsed,
          learnedPersonalPatternUsed: personalSymbolPatterns.length > 0,
          ...(!culturalProfileUsed ? {
            reason: hasBirthProfile ? 'cultural_sources_unavailable' : 'missing_birth_profile'
          } : {}),
        },
      },
      componentC: {
        similarDreams: similarDreamResult.matches,
        personalSymbolPatterns,
        observedSymbolPatterns,
      },
      componentD: {
        appliedRules: matchedRules,
        evidenceLinks: evidenceLinksAudit,
      },
    },
    strategyUsed,
  };
}
