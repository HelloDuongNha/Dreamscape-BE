import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import VerifiedKnowledgeRule, { IVerifiedKnowledgeRule, RuleClassification } from '../models/VerifiedKnowledgeRule';
import KnowledgeRuleEvidence from '../models/KnowledgeRuleEvidence';
import UserDreamProfile from '../models/UserDreamProfile';
import { generateAnalysis, ILLMOutput, generateEmbedding } from './llm.service';
import { retrieveSymbolsHybrid, IRetrievedSymbol, isExplicitSleepContextClause } from './symbolRetrieval.service';
import { buildScoringProfile } from './profileBuilder.service';
import {
  calculateComponentAScore,
  calculateComponentCScore,
  calculateComponentDScore,
  calculateDreamScore,
} from '../utils/dreamScoring';


// Interface for matched rules in audit trail
interface IAppliedRule {
  ruleId: string;
  group: string;
  factor: string;
  confidenceCap: number;
  claimStrength: string;
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

function cleanTranslationMistakes(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/Mô hình Simulasi Dị Nghi/g, 'Lý thuyết mô phỏng mối đe dọa')
    .replace(/mô hình Simulasi Dị Nghi/g, 'lý thuyết mô phỏng mối đe dọa')
    .replace(/Simulasi Dị Nghi/g, 'Lý thuyết mô phỏng mối đe dọa')
    .replace(/simulasi dị nghi/g, 'lý thuyết mô phỏng mối đe dọa')
    .replace(/Simulasi/g, 'mô phỏng')
    .replace(/simulasi/g, 'mô phỏng');
}

function sanitizeIncorrectTranslations(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return cleanTranslationMistakes(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeIncorrectTranslations(item));
  }
  if (typeof obj === 'object') {
    const copy: any = {};
    for (const key of Object.keys(obj)) {
      copy[key] = sanitizeIncorrectTranslations(obj[key]);
    }
    return copy;
  }
  return obj;
}

interface IAnalysisResult {
  aiAnalysis: ILLMOutput;
  retrievedContext: {
    componentA: {
      rawText: string;
      dreamNarrative: string;
      wakingReactionText: string;
      sleepContextText: string;
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
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function predictDreamClassifications(text: string): RuleClassification[] {
  const classifications: RuleClassification[] = [];
  const lower = text.toLowerCase();
  if (lower.includes('nhớ') || lower.includes('quên') || lower.includes('recall')) classifications.push(RuleClassification.DreamRecall);
  if (lower.includes('ác mộng') || lower.includes('nightmare') || lower.includes('sợ') || lower.includes('rượt đuổi') || lower.includes('chạy trốn') || lower.includes('nguy hiểm')) classifications.push(RuleClassification.Nightmares);
  if (lower.includes('mơ sáng suốt') || lower.includes('lucid') || lower.includes('nhận ra đang mơ') || lower.includes('tự chủ')) classifications.push(RuleClassification.LucidDreaming);
  if (lower.includes('lo lắng') || lower.includes('lo âu') || lower.includes('anxiety') || lower.includes('buồn') || lower.includes('giận') || lower.includes('khóc') || lower.includes('sợ hãi')) classifications.push(RuleClassification.EmotionalIncorporation);
  if (lower.includes('stress') || lower.includes('căng thẳng') || lower.includes('áp lực')) classifications.push(RuleClassification.StressIncorporation);
  if (lower.includes('chấn thương') || lower.includes('tai nạn') || lower.includes('quá khứ') || lower.includes('trauma')) classifications.push(RuleClassification.TraumaReplay);
  if (lower.includes('tiếng') || lower.includes('ồn') || lower.includes('nóng') || lower.includes('lạnh') || lower.includes('đau')) classifications.push(RuleClassification.ExternalStimulus);
  if (lower.includes('tư thế') || lower.includes('nằm') || lower.includes('sấp') || lower.includes('ngửa') || lower.includes('nghiêng')) classifications.push(RuleClassification.SleepPosture);
  if (lower.includes('môi trường') || lower.includes('phòng') || lower.includes('giường') || lower.includes('gối') || lower.includes('ánh sáng')) classifications.push(RuleClassification.SleepEnvironment);
  if (lower.includes('mệt') || lower.includes('mất ngủ') || lower.includes('tỉnh giấc') || lower.includes('chập chờn') || lower.includes('sâu')) classifications.push(RuleClassification.SleepQuality);
  if (classifications.length === 0) {
    classifications.push(RuleClassification.Other);
  }
  return classifications;
}

function enrichSleepContextFromText(text: string, currentContext: Record<string, any>): Record<string, any> {
  const enriched = { ...currentContext };
  if (!text) return enriched;

  // Split into clauses to evaluate each strictly
  const clauses = text.split(/,\s+(?=then\b|and\s+then\b|but\b)|\s+(?=then\b|and\s+then\b)|(?<=[.!?;\n])\s+/i);
  
  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    const check = isExplicitSleepContextClause(trimmed);
    if (!check.matched) continue; // Skip non-sleep context clauses

    const lower = trimmed.toLowerCase();
    
    if (lower.includes('back') || lower.includes('nằm ngửa') || lower.includes('nam ngua')) {
      enriched.position = 'supine';
    } else if (lower.includes('stomach') || lower.includes('nằm sấp') || lower.includes('nam sap')) {
      enriched.position = 'prone';
    }
    
    if (lower.includes('hot') || lower.includes('phòng nóng') || lower.includes('phong nong')) {
      enriched.temperature = 'hot';
    } else if (lower.includes('cold') || lower.includes('phòng lạnh') || lower.includes('phong lanh')) {
      enriched.temperature = 'cold';
    }
    
    if (lower.includes('late meal') || lower.includes('heavy eating') || lower.includes('ăn khuya') || lower.includes('an khuya') || lower.includes('ngủ muộn') || lower.includes('ngu muon')) {
      enriched.lateMeal = true;
    }
  }
  
  return enriched;
}

/**
 * Main Analysis Orchestration Pipeline.
 * Performs RAG on Symbol Dictionary and Knowledge Rules, calls Ollama, and constructs audit trails.
 */
export async function runDreamAnalysis(
  userId: string,
  dreamText: string,
  sleepContext: Record<string, any>
): Promise<IAnalysisResult> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not initialized');
  }

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

  let scoringProfile = (profileData as any).scoringProfile;
  if (!scoringProfile) {
    scoringProfile = buildScoringProfile(profileData.measuredPsychologicalProfile);
    try {
      if (!userProfile) {
        await UserDreamProfile.updateOne(
          { userId: new mongoose.Types.ObjectId(userId) },
          {
            $set: {
              ...defaultProfile,
              scoringProfile,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
      } else {
        await UserDreamProfile.updateOne(
          { userId: new mongoose.Types.ObjectId(userId) },
          { $set: { scoringProfile } }
        );
      }
      logger.info('Lazy backfilled scoringProfile for user dream profile', { userId });
    } catch (err) {
      logger.error('Failed to lazy backfill scoringProfile', err);
    }
  }

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

  // Enrich sleepContext using sleepContextText
  const enrichedSleepContext = enrichSleepContextFromText(sleepContextText, sleepContext || {});

  // ─── STEP 3: Multi-Source Rule Evaluation (Component D) ───
  // 1. Predict classifications of the dream based on keywords
  const predictedClassifications = predictDreamClassifications(dreamText);

  // 2. Pre-filter VerifiedKnowledgeRule records belonging to these predicted classifications
  const candidateRules = await VerifiedKnowledgeRule.find({
    classifications: { $in: predictedClassifications }
  }).lean();

  // 3. Embedding-based Top-K retrieval
  let matchedRules: any[] = [];
  try {
    const dreamEmbedding = await generateEmbedding(dreamText);
    const similarities = candidateRules.map(rule => {
      let score = 0;
      if (rule.embedding && rule.embedding.length === dreamEmbedding.length) {
        score = cosineSimilarity(dreamEmbedding, rule.embedding);
      }
      return { rule, score };
    });

    similarities.sort((a, b) => b.score - a.score);
    matchedRules = similarities.slice(0, 4).map(item => item.rule);
  } catch (err: any) {
    logger.warn('Failed to retrieve rules by embedding similarity, falling back to first 4 candidates', { error: String(err) });
    matchedRules = candidateRules.slice(0, 4);
  }

  // 4. Retrieve Academic Evidence links for the matched rules
  let validEvidenceLinks: any[] = [];
  try {
    const ruleIds = matchedRules.map(r => r._id);
    const rawEvidenceLinks = await KnowledgeRuleEvidence.find({
      ruleId: { $in: ruleIds }
    })
    .populate({
      path: 'chunkId',
      populate: {
        path: 'sourceId',
        select: 'title authors year journal publisher doi allowedUse readableInApp chunkBuildStatus'
      }
    })
    .lean();

    validEvidenceLinks = rawEvidenceLinks.filter((link: any) => {
      const src = link.chunkId?.sourceId;
      return src && src.readableInApp === true && src.allowedUse === 'open_access_fulltext' && src.chunkBuildStatus === 'completed';
    });
  } catch (err: any) {
    logger.warn('Failed to retrieve academic evidence links:', { error: String(err) });
  }

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

  for (const r of matchedRules) {
    const links = linksByRule.get(r._id.toString()) || [];
    if (links.length === 0) continue;

    // Limit to max 2 evidence links per rule
    const ruleLinks = links.slice(0, 2);
    let ruleText = '';
    const ruleSourcesList: any[] = [];

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

  const compactRulesText = matchedRules
    .map(
      (r) =>
        `- RuleCode: "${r.ruleCode}" (Statement: "${r.ruleStatement}", Basis: "${r.scientificBasis}", Classifications: "${r.classifications.join(', ')}")`
    )
    .join('\n');

  const culturalProfileText = profileData.preferences.allowCulturalAnalysis
    ? `Zodiac: ${profileData.culturalProfile.zodiac.viName} (Sign: ${profileData.culturalProfile.zodiac.sign}, Element: ${profileData.culturalProfile.zodiac.element}, Tags: ${profileData.culturalProfile.zodiac.tags.join(', ')}), Life Path: ${profileData.culturalProfile.lifePath.number} (Keywords: ${profileData.culturalProfile.lifePath.keywords.join(', ')}), Horary Hour: ${profileData.culturalProfile.horaryHour.branch}`
    : 'Not Allowed by User Preference';

  const basicProfile = profileData.basicProfile || {};
  const bigFive = profileData.measuredPsychologicalProfile.bigFive || {};
  const chronotype = profileData.measuredPsychologicalProfile.chronotype || {};
  const schemas = profileData.measuredPsychologicalProfile.schemas || {};

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

  const compactedPrompt = `
You are the DreamScape Oracle, a premium, rigorous AI dream psychologist and traditional cultural analyst.
Your task is to analyze the user's dream and output a strictly structured JSON analysis.

INPUT DATA:
Dream Text: "${dreamText}"
Sleep Context: ${JSON.stringify(enrichedSleepContext)}
${profileText}
${promptEvidenceSection}
RETRIEVED KNOWLEDGE RULES (Evaluate and apply instructions carefully):
${compactRulesText || 'None'}

RETRIEVED DICTIONARY SYMBOLS:
${compactSymbolsText || 'None'}

RESPONSE FORMAT:
You MUST output a single, flat JSON object. Do not wrap your response in markdown formatting (no \`\`\`json block), and do not add any comments or text before/after the JSON.
The JSON object must match this exact TypeScript interface:
{
  "title": "A short, beautiful, poetic title in Vietnamese",
  "emotional_tone": "The primary emotional tone of the dream (e.g. Lucid, Calm, Intense, Distress, Anxiety)",
  "summary": "A concise summary of the dream narrative in Vietnamese",
  "scientific_context_notes": [
    { "ruleId": "The matched rule ID", "note": "An explanation of how this rule applies to the dream content or sleep context in Vietnamese", "confidence": 0.0 }
  ],
  "symbolic_notes": [
    { "symbol": "The matched symbol name", "meaning": "A tailored explanation of how this symbol is interpreted within the dream context, respecting the dictionary meaning, in Vietnamese", "relevance": 0.0, "symbolValence": 0 }
  ],
  "cultural_symbolic_notes": [
    { "source": "The source framework (e.g. Zodiac, Numerology, Horary Branch)", "note": "A reflective, non-deterministic Vietnamese explanation of how the user's cultural parameters align with themes in the dream." }
  ],
  "real_life_hypotheses": [
    { "hypothesis": "A concrete hypothesis about the user's waking life in Vietnamese", "evidenceFromDream": ["Direct quotes or specific events from the dream serving as evidence"], "confidence": 0.0, "needsUserConfirmation": true, "followUpQuestion": "A clarifying question for the user to confirm/deny this hypothesis in Vietnamese" }
  ],
  "dreamValenceScore": 0, // Integer score from 0 (extremely negative/nightmare) to 100 (extremely positive/lucid/blissful)
  "confidence": 0.0, // Overall analysis confidence score between 0.0 and 1.0 (Must respect the rule confidenceCap if applied!)
  "core_analysis": "A deep, premium, cohesive psychological and symbolic interpretation of the dream in Vietnamese, blending RAG inputs and context.",
  "disclaimer": "The standard disclaimer that this analysis is for reflective purposes and does not constitute medical/clinical diagnosis, in Vietnamese."
}

CRITICAL RULES:
1. All note, hypothesis, summary, analysis, and follow-up text fields MUST be written in Vietnamese (Tiếng Việt).
2. Translate "Threat Simulation Theory (TST)" into Vietnamese as "Lý thuyết mô phỏng mối đe dọa". Never use "Simulasi Dị Nghi" or similar incorrect terms.
3. Make all scientific notes cautious using terms like "có thể", "một khung diễn giải", "không phải chẩn đoán", "không khẳng định quan hệ nhân quả chắc chắn".
4. The overall "confidence" float must respect the "confidenceCap" of any matched rules. If multiple rules are matched, the confidence should not exceed the minimum confidenceCap of those matched rules.
5. If no symbols or rules were retrieved, adjust confidence and notes accordingly.
6. Ensure all JSON fields are populated and contain valid types.
`;

  // ─── STEP 5: LLM Generation ───
  const rawAiAnalysis = await generateAnalysis(compactedPrompt);
  const normalizedAiAnalysis = normalizeObjectPunctuation(rawAiAnalysis);
  const aiAnalysis = sanitizeIncorrectTranslations(normalizedAiAnalysis);

  // Post-process aiAnalysis to ensure consistent symbolValence with dictionary symbols
  if (aiAnalysis && Array.isArray(aiAnalysis.symbolic_notes)) {
    for (const note of aiAnalysis.symbolic_notes) {
      const noteSymLower = (note.symbol || '').trim().toLowerCase();
      const matchedSym = retrievedSymbols.find(s => {
        const symLower = s.symbol.toLowerCase().trim();
        const canonLower = (s.canonicalSymbol || '').toLowerCase().trim();
        return symLower === noteSymLower || canonLower === noteSymLower || s.matchedVariants?.some(v => v.toLowerCase().trim() === noteSymLower);
      });
      if (matchedSym) {
        note.symbolValence = matchedSym.symbolValence;
        note.symbol = matchedSym.symbol;
      }
    }
  }

  // Post-process scientific_context_notes to own citations, validate rules, and normalize confidence
  if (aiAnalysis) {
    if (matchedRules.length === 0) {
      aiAnalysis.scientific_context_notes = [];
    } else if (Array.isArray(aiAnalysis.scientific_context_notes)) {
      const validRuleIds = new Set(matchedRules.map(r => r.ruleId));
      const finalNotes: any[] = [];

      for (const note of aiAnalysis.scientific_context_notes) {
        const cleanRuleId = (note.ruleId || '').trim();
        
        // Note-rule validation: keep only notes with ruleId matching appliedRules
        if (!validRuleIds.has(cleanRuleId)) {
          logger.warn(`Discarding scientific_context_note with unknown ruleId: "${cleanRuleId}"`);
          continue;
        }

        const matchedRule = matchedRules.find(r => r.ruleId === cleanRuleId);
        const confidenceCap = matchedRule ? matchedRule.confidenceCap : 1.0;

        // Confidence normalization
        let rawConfidence = Number(note.confidence);
        if (isNaN(rawConfidence) || note.confidence === undefined || note.confidence === null) {
          rawConfidence = 0.5;
        }
        const normalizedConfidence = Math.min(confidenceCap, Math.max(0.0, rawConfidence));

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

        finalNotes.push({
          ruleId: cleanRuleId,
          note: (note.note || '').trim(),
          confidence: normalizedConfidence,
          ...(finalSources.length > 0 ? { sources: finalSources } : {})
        });
      }

      aiAnalysis.scientific_context_notes = finalNotes;
    }
  }

  // Calculate deterministic dream score and breakdown (Backend owned)
  const resA = calculateComponentAScore(promptSymbols);
  const resD = calculateComponentDScore(matchedRules);
  const resC = calculateComponentCScore();

  const ScoreB = scoringProfile.profileScore;
  const factorsB = (scoringProfile.factors || []).map((f: any) => ({
    source: 'B' as const,
    factor: f.source,
    impact: f.impact,
    reason: f.reason
  }));

  const combinedFactors = [
    ...resA.factors,
    ...factorsB,
    ...resC.factors,
    ...resD.factors
  ];

  const scoreBreakdown = calculateDreamScore(
    {
      scoreA: resA.score,
      scoreB: ScoreB,
      scoreC: resC.score,
      scoreD: resD.score
    },
    {
      reasonA: resA.reason,
      reasonB: scoringProfile.profileImpact === 0 ? "No measured psychological profile available." : "Based on user psychological and sleep habits profile.",
      reasonC: resC.reason,
      reasonD: resD.reason
    },
    combinedFactors
  );

  // Override LLM values with backend-owned deterministic values
  if (aiAnalysis) {
    aiAnalysis.dreamValenceScore = scoreBreakdown.finalScore;
    aiAnalysis.score_breakdown = scoreBreakdown;
  }

  // ─── STEP 6: Construct Audit Trail ───
  const hasBirthProfile = !!(
    (profileData.basicProfile?.birthDate && profileData.basicProfile.birthDate.trim() !== '') ||
    (profileData.culturalProfile?.zodiac?.sign && profileData.culturalProfile.zodiac.sign !== 'unknown') ||
    (profileData.culturalProfile?.lifePath?.number && profileData.culturalProfile.lifePath.number !== 0) ||
    (profileData.culturalProfile?.horaryHour?.branch && profileData.culturalProfile.horaryHour.branch !== 'unknown')
  );
  const culturalProfileUsed = (profileData.preferences?.allowCulturalAnalysis === true) && hasBirthProfile;
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
  }));

  return {
    aiAnalysis,
    retrievedContext: {
      componentA: {
        rawText,
        dreamNarrative,
        wakingReactionText,
        sleepContextText,
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
          learnedPersonalPatternUsed: false,
          ...(!culturalProfileUsed && !hasBirthProfile ? { reason: "missing_birth_profile" } : {}),
        },
      },
      componentD: {
        appliedRules: matchedRules,
        evidenceLinks: evidenceLinksAudit,
      },
    },
    strategyUsed,
  };
}
