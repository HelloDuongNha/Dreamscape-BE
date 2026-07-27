import mongoose from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import { generateAnalysis, ILLMOutput } from '../../../../../infrastructure/llm.service';
import { buildDreamAnalysisPrompt } from '../prompts/dreamAnalysis.prompt';
import {
  DreamAnalysisProgress,
  DreamAnalysisResult,
  DreamAnalysisStage,
} from './dreamAnalysisOrchestration.types';
import {
  buildDreamProfilePrompt,
  loadDreamAnalysisProfile,
} from './dreamAnalysisProfile.service';
import { buildDreamPromptContext } from './dreamAnalysisPromptContext.service';
import { retrieveDreamAnalysisContext } from './dreamContextRetrieval.service';
import { retrieveDreamRuleEvidence } from './dreamRuleEvidence.service';
import { finalizeDreamAnalysisOutput } from './dreamAnalysisOutput.service';
import {
  generateDreamContinuation,
} from '../creation/dreamContinuation.service';

export type { DreamAnalysisProgress, DreamAnalysisStage } from './dreamAnalysisOrchestration.types';

// Runs the six-stage dream analysis pipeline and returns its audit trail.
export async function runDreamAnalysis(
  userId: string,
  dreamText: string,
  sleepContext: Record<string, any>,
  onProgress?: (progress: DreamAnalysisProgress) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<DreamAnalysisResult> {
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
  const profileData = await loadDreamAnalysisProfile(userId);

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
    segmentationReasons,
    enrichedSleepContext,
    similarDreamResult,
    personalSymbolPatterns,
    contextualMotifHints,
    observedSymbolPatterns,
  } = await retrieveDreamAnalysisContext(userId, dreamText, sleepContext);

  await report(
    'retrieving_context',
    34,
    'Đã nhận diện xong các chi tiết và trường hợp tương đồng.',
    'Đang chuyển các kết quả phù hợp sang bước kiểm tra tri thức.',
    `Nhận diện ${retrievedSymbols.length} mục từ điển, ${contextualMotifHints.length} chi tiết theo ngữ cảnh, ${observedSymbolPatterns.length} mẫu trong kho quan sát, ${similarDreamResult.matches.length} giấc mơ tương đồng, ${personalSymbolPatterns.length} mô-típ cá nhân lặp lại và ${Object.keys(enrichedSleepContext).length} dữ kiện về điều kiện ngủ.`,
  );

  await report('retrieving_rules', 38, 'Đang chọn lập luận phù hợp và kiểm tra dẫn chứng...', 'Đang lọc kết luận mô tả, câu hỏi kiểm tra và cơ chế tâm lý.');
  const {
    matchedRules,
    explanatoryRules,
    questionRules,
    usableRules: llmUsableRules,
    validEvidenceLinks,
    evidenceLinksAudit,
    validSourcesMap,
    validEvidenceMap,
    promptEvidenceSection,
  } = await retrieveDreamRuleEvidence(dreamNarrative);

  await report(
    'retrieving_rules',
    48,
    'Đã kiểm tra xong phần tri thức có thể dùng.',
    'Đang đóng gói phần dữ liệu đã kiểm chứng để viết kết quả.',
    `Tìm thấy ${matchedRules.length} kết luận liên quan; ${explanatoryRules.length} kết luận có thể hỗ trợ giải thích tâm lý và ${questionRules.length} kết luận có điều kiện có thể kiểm tra. Số câu hỏi cuối cùng còn phụ thuộc chi tiết thật sự xuất hiện trong lời kể; ${validEvidenceLinks.length} liên kết dẫn chứng đã được kiểm tra.`,
  );

  const { profileText, culturalProfileUsed, hasBirthProfile } = buildDreamProfilePrompt(profileData);
  const {
    compactSymbolsText,
    compactRulesText,
    personalPatternText,
    observedSymbolText,
    similarDreamText,
  } = buildDreamPromptContext({
    retrievedSymbols,
    usableRules: llmUsableRules,
    personalSymbolPatterns,
    observedSymbolPatterns,
    similarDreams: similarDreamResult.matches,
  });

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
  const aiAnalysis = finalizeDreamAnalysisOutput({
    rawAnalysis: rawAiAnalysis,
    dreamNarrative,
    wakingReactionText,
    retrievedSymbols,
    matchedRules,
    explanatoryRules,
    questionRules,
    validSourcesMap,
    validEvidenceMap,
    culturalProfileUsed,
    similarDreams: similarDreamResult.matches,
  });
  await report(
    'finalizing',
    92,
    'Đang viết phần tiếp theo của giấc mơ...',
    'Phần phân tích đã hoàn tất; đang dùng bộ sáng tác riêng để nối tiếp câu chuyện.',
  );
  aiAnalysis.creative_continuation = await generateDreamContinuation(dreamNarrative);

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
