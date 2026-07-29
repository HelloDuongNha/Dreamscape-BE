import mongoose from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import { generateAnalysis, ILLMOutput } from '../../../../../infrastructure/llm.service';
import { generateDreamContinuation } from '../creation/dreamContinuation.service';
import { resolveDreamAnalysisModel } from '../grounding/dreamAnalysisQuality.service';
import { buildDreamAnalysisPrompt } from '../prompts/dreamAnalysis.prompt';
import {
  DreamAnalysisProgress,
  DreamAnalysisReporter,
  DreamAnalysisResult,
  DreamAnalysisStage,
} from './dreamAnalysisOrchestration.types';
import { finalizeDreamAnalysisOutput } from './dreamAnalysisOutput.service';
import { groundDreamCitationClaims } from '../grounding/dreamCitationGrounding.service';
import { buildDreamAnalysisResult } from './dreamAnalysisResult.service';
import {
  buildDreamProfilePrompt,
  loadDreamAnalysisProfile,
} from './dreamAnalysisProfile.service';
import { buildDreamPromptContext } from './dreamAnalysisPromptContext.service';
import { retrieveDreamAnalysisContext } from './dreamContextRetrieval.service';
import { retrieveDreamRuleEvidence } from './dreamRuleEvidence.service';

export type { DreamAnalysisProgress, DreamAnalysisStage } from './dreamAnalysisOrchestration.types';

type DreamProfileData = Awaited<ReturnType<typeof loadDreamAnalysisProfile>>;
type RetrievedDreamContext = Awaited<ReturnType<typeof retrieveDreamAnalysisContext>>;
type RetrievedRuleEvidence = Awaited<ReturnType<typeof retrieveDreamRuleEvidence>>;
type DreamProfilePrompt = ReturnType<typeof buildDreamProfilePrompt>;

interface DreamAnalysisRequest {
  userId: string;
  dreamText: string;
  sleepContext: Record<string, any>;
  abortSignal?: AbortSignal;
}

// Run the grounded dream-analysis pipeline and return its audit trail.
export async function runDreamAnalysis(
  userId: string,
  dreamText: string,
  sleepContext: Record<string, any>,
  onProgress?: (progress: DreamAnalysisProgress) => void | Promise<void>,
  abortSignal?: AbortSignal,
): Promise<DreamAnalysisResult> {
  requireDreamDatabase();
  const request = { userId, dreamText, sleepContext, abortSignal };
  const report = createProgressReporter(onProgress, abortSignal);

  const profile = await prepareDreamProfile(userId, report);
  const context = await retrieveDreamContext(request, report);
  const rules = await retrieveGroundedRules(context, report);
  const profilePrompt = buildDreamProfilePrompt(profile);
  const prompt = buildGroundedPrompt(context, rules, profilePrompt);
  const analysis = await generateGroundedAnalysis(request, context, rules, profilePrompt, prompt, report);

  return buildDreamAnalysisResult({
    profile,
    context,
    rules,
    profilePrompt,
    analysis,
    report,
  });
}

async function prepareDreamProfile(
  userId: string,
  report: DreamAnalysisReporter,
): Promise<DreamProfileData> {
  await report(
    'preparing',
    8,
    'Đang chuẩn bị hồ sơ và ngữ cảnh phân tích...',
    'Đang đọc hồ sơ và tách phần lời kể cần phân tích.',
  );
  const profile = await loadDreamAnalysisProfile(userId);
  await report(
    'preparing',
    18,
    'Đã chuẩn bị xong đầu vào phân tích.',
    'Đã tách lời kể khỏi thông tin khi thức và nạp các tùy chọn cá nhân được cho phép.',
    'Đã nạp hồ sơ và các lựa chọn cá nhân hóa được người dùng cho phép.',
  );
  return profile;
}

async function retrieveDreamContext(
  request: DreamAnalysisRequest,
  report: DreamAnalysisReporter,
): Promise<RetrievedDreamContext> {
  await report(
    'retrieving_context',
    20,
    'Đang nhận diện chi tiết và tìm các giấc mơ tương đồng...',
    'Đang đối chiếu từ điển, mô-típ theo ngữ cảnh và lịch sử giấc mơ.',
  );
  const context = await retrieveDreamAnalysisContext(
    request.userId,
    request.dreamText,
    request.sleepContext,
  );
  await report(
    'retrieving_context',
    34,
    'Đã nhận diện xong các chi tiết và trường hợp tương đồng.',
    'Đang chuyển các kết quả phù hợp sang bước kiểm tra tri thức.',
    `Nhận diện ${context.symbols.length} mục từ điển, ${context.contextualMotifHints.length} chi tiết theo ngữ cảnh, ${context.observedSymbolPatterns.length} mẫu trong kho quan sát, ${context.similarDreamResult.matches.length} giấc mơ tương đồng, ${context.personalSymbolPatterns.length} mô-típ cá nhân lặp lại và ${Object.keys(context.enrichedSleepContext).length} dữ kiện về điều kiện ngủ.`,
  );
  return context;
}

async function retrieveGroundedRules(
  context: RetrievedDreamContext,
  report: DreamAnalysisReporter,
): Promise<RetrievedRuleEvidence> {
  await report(
    'retrieving_rules',
    38,
    'Đang chọn lập luận phù hợp và kiểm tra dẫn chứng...',
    'Đang lọc kết luận mô tả, câu hỏi kiểm tra và cơ chế tâm lý.',
  );
  const rules = await retrieveDreamRuleEvidence(context.dreamNarrative);
  await report(
    'retrieving_rules',
    48,
    'Đã kiểm tra xong phần tri thức có thể dùng.',
    'Đang đóng gói phần dữ liệu đã kiểm chứng để viết kết quả.',
    `Tìm thấy ${rules.matchedRules.length} kết luận liên quan; ${rules.explanatoryRules.length} kết luận có thể hỗ trợ giải thích tâm lý và ${rules.questionRules.length} kết luận có điều kiện có thể kiểm tra. Số câu hỏi cuối cùng còn phụ thuộc chi tiết thật sự xuất hiện trong lời kể; ${rules.validEvidenceLinks.length} liên kết dẫn chứng đã được kiểm tra.`,
  );
  return rules;
}

function buildGroundedPrompt(
  context: RetrievedDreamContext,
  rules: RetrievedRuleEvidence,
  profile: DreamProfilePrompt,
): string {
  const promptContext = buildDreamPromptContext({
    retrievedSymbols: context.symbols,
    usableRules: rules.usableRules,
    personalSymbolPatterns: context.personalSymbolPatterns,
    observedSymbolPatterns: context.observedSymbolPatterns,
    similarDreams: context.similarDreamResult.matches,
  });

  return buildDreamAnalysisPrompt({
    dreamNarrative: context.dreamNarrative,
    wakingContext: context.wakingReactionText,
    sleepContext: context.enrichedSleepContext,
    profileContext: profile.profileText,
    evidenceContext: rules.promptEvidenceSection,
    ruleContext: promptContext.compactRulesText,
    dictionaryContext: promptContext.compactSymbolsText,
    personalSymbolContext: promptContext.personalPatternText,
    observedSymbolContext: promptContext.observedSymbolText,
    similarDreamContext: promptContext.similarDreamText,
    contextualMotifs: context.contextualMotifHints,
    culturalAnalysisAllowed: profile.culturalProfileUsed,
  });
}

async function generateGroundedAnalysis(
  request: DreamAnalysisRequest,
  context: RetrievedDreamContext,
  rules: RetrievedRuleEvidence,
  profile: DreamProfilePrompt,
  prompt: string,
  report: DreamAnalysisReporter,
): Promise<ILLMOutput> {
  await report(
    'generating_analysis',
    55,
    'Mô hình đang tổng hợp các mạch diễn giải có căn cứ...',
    'Đang nối chuỗi sự kiện, cảm xúc, trường hợp tương đồng và phần tri thức đã kiểm chứng.',
  );
  const rawAnalysis = await callDreamAnalysisModel(prompt, request.abortSignal);
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

  const analysis = finalizeDreamAnalysisOutput({
    rawAnalysis,
    dreamNarrative: context.dreamNarrative,
    wakingReactionText: context.wakingReactionText,
    retrievedSymbols: context.symbols,
    matchedRules: rules.matchedRules,
    explanatoryRules: rules.explanatoryRules,
    questionRules: rules.questionRules,
    validSourcesMap: rules.validSourcesMap,
    validEvidenceMap: rules.validEvidenceMap,
    culturalProfileUsed: profile.culturalProfileUsed,
    similarDreams: context.similarDreamResult.matches,
  });
  groundDreamCitationClaims(analysis, {
    citableRules: rules.usableRules,
    validSourcesMap: rules.validSourcesMap,
    validEvidenceMap: rules.validEvidenceMap,
  });
  await report(
    'finalizing',
    92,
    'Đang viết phần tiếp theo của giấc mơ...',
    'Phần phân tích đã hoàn tất; đang dùng bộ sáng tác riêng để nối tiếp câu chuyện.',
  );
  analysis.creative_continuation = await generateDreamContinuation(context.dreamNarrative);
  return analysis;
}

async function callDreamAnalysisModel(
  prompt: string,
  abortSignal?: AbortSignal,
): Promise<ILLMOutput> {
  try {
    const analysis = await generateAnalysis(prompt, abortSignal, {
      model: resolveDreamAnalysisModel(),
      numCtx: resolveDreamAnalysisContextWindow(),
      numPredict: 3200,
    });
    analysis.analysis_mode = 'llm_grounded';
    return analysis;
  } catch (error) {
    logger.warn('Dream analysis generation failed; no synthetic case-specific answer was created.', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function resolveDreamAnalysisContextWindow(): number {
  return Math.max(
    4096,
    Number(process.env.DREAM_CONTEXT_WINDOW)
      || Number(process.env.ORACLE_CONTEXT_WINDOW)
      || 32768,
  );
}

function createProgressReporter(
  onProgress: ((progress: DreamAnalysisProgress) => void | Promise<void>) | undefined,
  abortSignal?: AbortSignal,
): DreamAnalysisReporter {
  return async (stage, progress, message, miniStep, resultSummary) => {
    throwIfAnalysisCancelled(abortSignal);
    await onProgress?.({ stage, progress, message, miniStep, resultSummary });
  };
}

function requireDreamDatabase(): void {
  if (!mongoose.connection.db) {
    throw new Error('Database connection is not initialized');
  }
}

function throwIfAnalysisCancelled(abortSignal?: AbortSignal): void {
  if (!abortSignal?.aborted) return;
  const error = new Error('dream_analysis_cancelled');
  error.name = 'AbortError';
  throw error;
}
