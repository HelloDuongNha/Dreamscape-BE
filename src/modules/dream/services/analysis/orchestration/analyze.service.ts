import mongoose from 'mongoose';
import { logger } from '../../../../../infrastructure/logger';
import { generateAnalysis, ILLMOutput } from '../../../../../infrastructure/llm.service';
import {
  assessDreamAnalysisDepth,
  resolveDreamAnalysisModel,
  selectDeeperDreamAnalysis,
} from '../grounding/dreamAnalysisQuality.service';
import {
  buildDreamAnalysisPrompt,
  buildDreamAnalysisRepairPrompt,
} from '../prompts/dreamAnalysis.prompt';
import {
  DreamAnalysisProgress,
  DreamAnalysisReporter,
  DreamAnalysisResult,
  DreamAnalysisStage,
} from './dreamAnalysisOrchestration.types';
import { finalizeDreamAnalysisOutput } from './dreamAnalysisOutput.service';
import {
  countResolvableDreamCitationClaims,
  groundDreamCitationClaims,
  type DreamCitationGroundingContext,
} from '../grounding/dreamCitationGrounding.service';
import { buildDreamAnalysisResult } from './dreamAnalysisResult.service';
import { buildDreamPromptContext } from './dreamAnalysisPromptContext.service';
import { retrieveDreamAnalysisContext } from './dreamContextRetrieval.service';
import { retrieveDreamRuleEvidence } from './dreamRuleEvidence.service';

export type { DreamAnalysisProgress, DreamAnalysisStage } from './dreamAnalysisOrchestration.types';

type RetrievedDreamContext = Awaited<ReturnType<typeof retrieveDreamAnalysisContext>>;
type RetrievedRuleEvidence = Awaited<ReturnType<typeof retrieveDreamRuleEvidence>>;

const DREAM_ANALYSIS_USER_CONTEXT =
  'No demographic, zodiac, personality-test, or preset symbolic profile is available. '
  + 'Use only the current narrative, observed prior cases, similar dreams, and cited knowledge.';

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

  await prepareDreamInput(report);
  const context = await retrieveDreamContext(request, report);
  const rules = await retrieveGroundedRules(context, report);
  const prompt = buildGroundedPrompt(context, rules);
  const analysis = await generateGroundedAnalysis(request, context, rules, prompt, report);

  return buildDreamAnalysisResult({
    context,
    rules,
    analysis,
    report,
  });
}

async function prepareDreamInput(
  report: DreamAnalysisReporter,
): Promise<void> {
  await report(
    'preparing',
    8,
    'Đang chuẩn bị ngữ cảnh phân tích...',
    'Đang tách phần lời kể cần phân tích.',
  );
  await report(
    'preparing',
    18,
    'Đã chuẩn bị xong đầu vào phân tích.',
    'Đã tách lời kể khỏi thông tin khi thức.',
    'Chỉ dùng lời kể, các trường hợp đã quan sát và tri thức có nguồn.',
  );
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
    profileContext: DREAM_ANALYSIS_USER_CONTEXT,
    evidenceContext: rules.promptEvidenceSection,
    ruleContext: promptContext.compactRulesText,
    recognizedSymbolContext: promptContext.recognizedSymbolText,
    personalSymbolContext: promptContext.personalPatternText,
    observedSymbolContext: promptContext.observedSymbolText,
    similarDreamContext: promptContext.similarDreamText,
    contextualMotifs: context.contextualMotifHints,
    culturalAnalysisAllowed: false,
  });
}

async function generateGroundedAnalysis(
  request: DreamAnalysisRequest,
  context: RetrievedDreamContext,
  rules: RetrievedRuleEvidence,
  prompt: string,
  report: DreamAnalysisReporter,
): Promise<ILLMOutput> {
  await report(
    'generating_analysis',
    55,
    'Mô hình đang tổng hợp các mạch diễn giải có căn cứ...',
    'Đang nối chuỗi sự kiện, cảm xúc, trường hợp tương đồng và phần tri thức đã kiểm chứng.',
  );
  const firstAnalysis = await callDreamAnalysisModel(prompt, request.abortSignal);
  const citationContext = buildCitationGroundingContext(rules);
  const firstResolvableClaimCount = countResolvableDreamCitationClaims(
    firstAnalysis,
    citationContext,
  );
  const depth = assessDreamAnalysisDepth(
    firstAnalysis,
    context.dreamNarrative,
    rules.usableRules.length > 0,
    firstResolvableClaimCount,
  );
  let rawAnalysis = firstAnalysis;
  if (!depth.acceptable) {
    const repairedAnalysis = await callDreamAnalysisModel(
      buildDreamAnalysisRepairPrompt({
        prompt,
        ...depth,
        hasCitableRules: rules.usableRules.length > 0,
      }),
      request.abortSignal,
      resolveDreamRepairModel(),
    );
    rawAnalysis = selectDeeperDreamAnalysis(
      firstAnalysis,
      repairedAnalysis,
      context.dreamNarrative,
      rules.usableRules.length > 0,
      firstResolvableClaimCount,
      countResolvableDreamCitationClaims(
        repairedAnalysis,
        citationContext,
      ),
    );
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
    culturalProfileUsed: false,
    similarDreams: context.similarDreamResult.matches,
  });
  groundDreamCitationClaims(analysis, citationContext);
  return analysis;
}

function buildCitationGroundingContext(
  rules: RetrievedRuleEvidence,
): DreamCitationGroundingContext {
  return {
    citableRules: rules.usableRules,
    validSourcesMap: rules.validSourcesMap,
    validEvidenceMap: rules.validEvidenceMap,
  };
}

async function callDreamAnalysisModel(
  prompt: string,
  abortSignal?: AbortSignal,
  model = resolveDreamAnalysisModel(),
): Promise<ILLMOutput> {
  try {
    const analysis = await generateAnalysis(prompt, abortSignal, {
      model,
      numCtx: resolveDreamAnalysisContextWindow(),
      numPredict: 3200,
      temperature: 0.2,
      seed: Math.floor(Math.random() * 2_147_483_647),
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

function resolveDreamRepairModel(): string {
  return process.env.DREAM_OLLAMA_REPAIR_MODEL
    || resolveDreamAnalysisModel();
}

function resolveDreamAnalysisContextWindow(): number {
  return Math.max(
    4096,
    Number(process.env.DREAM_CONTEXT_WINDOW)
      || Number(process.env.ORACLE_CONTEXT_WINDOW)
      || 16384,
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
