import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logger';
import OracleRun, { type IOracleRun } from '../../models/OracleRun';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import { captureOracleEvidenceGaps } from '../evidence/oracleEvidenceCapture.service';
import { resolveOracleModelAdapter } from '../providers/oracleProviderResolver.service';
import { buildOracleGrounding } from '../grounding/oracleGrounding.service';
import { validateAcademicCitationSupport } from '../grounding/oracleCitationValidation.service';
import {
  compactUsedCitations,
  ensurePersonalContextCitation,
  ensureRuleBackedFinalQuestion,
  finalizeModelAnswer,
  markUnsupportedInterpretations,
} from '../presentation/oracleAnswerFinalization.service';
import {
  generateFallbackSuggestions,
  prioritizeOracleSuggestions,
} from '../presentation/oracleSuggestion.service';
import {
  buildOracleCreativeCanonPrompt,
  repairOracleCreativeAnswerIfNeeded,
} from '../presentation/oracleCreativeContinuation.service';
import { loadOracleConversation } from './oracleConversation.service';
import { appendOracleRunEvent } from './oracleRunEvent.service';
import { completeOracleRun, failOracleRun } from '../persistence/oracleRunFinalization.service';
import {
  buildOracleSystemPrompt,
  findLatestDreamNarrative,
  isVietnameseText,
  resolveOracleModel,
  type OracleExecutionMode,
} from '../providers/oraclePrompt.service';
import { resolveOracleExecutionMode } from './oracleIntentRouting.service';
import { compactOracleContext } from './oracleContextCompaction.service';
import { estimateOracleRunDuration } from './oracleRunTiming.service';
import {
  sanitizeOracleUnresolvedMarkers,
} from '../../../../shared/evidence/evidenceClaim';

const activeRuns = new Map<string, AbortController>();

export function abortOracleRun(runId: string): void {
  activeRuns.get(runId)?.abort();
}

// Execute one queued Oracle run through grounding, generation, citation finalization, and persistence.
export async function executeOracleRun(runId: Types.ObjectId): Promise<void> {
  const execution = claimLocalExecution(runId);
  if (!execution) return;
  let run: IOracleRun | null = null;
  let partialAnswer = '';

  try {
    run = await claimPersistedRun(runId);
    if (!run) return;

    const context = await prepareRunContext(run, execution.controller.signal);
    if (!context) return;
    const generation = await generateOracleAnswer({
      run,
      runId,
      controller: execution.controller,
      ...context,
    });
    partialAnswer = generation.answer;

    await publishAnswerEvents(runId, run, generation.answer, generation.citations);
    await completeOracleRun({
      run,
      runId,
      answer: generation.answer,
      citations: generation.citations,
      suggestedPrompts: generation.suggestedPrompts,
      promptTokens: generation.promptTokens,
      contextWindow: generation.contextWindow,
      provider: generation.provider,
      modelName: generation.model,
      preparationStartedAt: generation.preparationStartedAt,
      includedMessages: generation.includedMessages,
      omittedMessages: generation.omittedMessages,
      expectedMinMs: generation.estimate.minMs,
      expectedMaxMs: generation.estimate.maxMs,
    });
  } catch (error) {
    logger.error('Oracle run execution failed.', error, {
      runId: String(runId),
      userId: run ? String(run.userId) : undefined,
      aborted: execution.controller.signal.aborted,
    });
    if (run) {
      await failOracleRun({
        run,
        runId,
        partialAnswer,
        cancelled: execution.controller.signal.aborted,
      });
    }
  } finally {
    activeRuns.delete(execution.key);
  }
}

function claimLocalExecution(runId: Types.ObjectId): {
  key: string;
  controller: AbortController;
} | null {
  const key = String(runId);
  if (activeRuns.has(key)) return null;
  const controller = new AbortController();
  activeRuns.set(key, controller);
  return { key, controller };
}

async function claimPersistedRun(runId: Types.ObjectId): Promise<IOracleRun | null> {
  const run = await OracleRun.findById(runId);
  if (!run || !['queued', 'running'].includes(run.status)) return null;
  const thread = await OracleThread.findOne({
    _id: run.threadId,
    userId: run.userId,
    deletedAt: { $exists: false },
  });
  if (!thread) return null;
  await Promise.all([
    OracleRun.updateOne(
      { _id: runId, status: { $in: ['queued', 'running'] } },
      { $set: { status: 'running' } },
    ),
    OracleTurn.updateOne(
      { _id: run.assistantTurnId },
      { $set: { status: 'streaming' } },
    ),
  ]);
  return run;
}

// Prepare the grounded context shared by the answer generator and citation resolver.
async function prepareRunContext(run: IOracleRun, signal: AbortSignal) {
  const messages = await loadOracleConversation(run.threadId, run.userId, run.userTurnId);
  const latestUserText = [...messages].reverse()
    .find((message) => message.role === 'user')?.content || '';
  const adapter = await resolveOracleModelAdapter(run.userId);
  const routingModel = adapter.modelOverride || (adapter.name === 'openai_compatible'
    ? String(process.env.ORACLE_EXTERNAL_MODEL || resolveOracleModel('chat'))
    : resolveOracleModel('chat'));
  const routing = await resolveOracleExecutionMode({
    adapter,
    messages,
    model: routingModel,
    signal,
  });
  const mode = routing.mode;
  const groundingText = mode === 'dream_analysis'
    ? findLatestDreamNarrative(messages) || latestUserText
    : latestUserText;
  const grounding = mode === 'dream_analysis'
    ? await buildOracleGrounding(String(run.userId), groundingText)
    : { citations: [], promptContext: '', verificationQuestions: [] };
  const model = adapter.modelOverride || (adapter.name === 'openai_compatible'
    ? String(process.env.ORACLE_EXTERNAL_MODEL || resolveOracleModel(mode))
    : resolveOracleModel(mode));
  const contextWindow = Math.max(4096, Number(process.env.ORACLE_CONTEXT_WINDOW) || 32768);
  const maxOutputTokens = mode === 'chat' ? 600 : 1400;
  const systemPrompt = [
    buildOracleSystemPrompt(mode),
    mode === 'creative_continuation' ? buildOracleCreativeCanonPrompt(messages) : '',
  ].filter(Boolean).join('\n\n');
  const compactedContext = compactOracleContext({
    messages,
    contextWindow,
    systemPrompt,
    groundingPrompt: grounding.promptContext,
    maxOutputTokens,
  });
  const workload = {
    inputChars: latestUserText.length,
    contextChars: compactedContext.messages
      .reduce((total, message) => total + message.content.length, 0),
    retrievalChars: grounding.promptContext.length,
    citationCount: grounding.citations.length,
  };
  const estimate = await estimateOracleRunDuration(run.userId, mode, model, workload);
  await OracleRun.updateOne(
    { _id: run._id },
    {
      $set: {
        mode,
        modelName: model,
        ...workload,
        expectedMinMs: estimate.minMs,
        expectedMaxMs: estimate.maxMs,
        stage: 'thinking',
        stageStartedAt: new Date(),
      },
    },
  );
  return {
    messages: compactedContext.messages,
    mode,
    latestUserText,
    groundingText,
    grounding,
    adapter,
    model,
    estimate,
    contextWindow,
    maxOutputTokens,
    systemPrompt,
    includedMessages: compactedContext.includedMessages,
    omittedMessages: compactedContext.omittedMessages,
  };
}

// Generate the narrative answer from the grounded context without mutating run state.
async function generateOracleAnswer(input: {
  run: IOracleRun;
  runId: Types.ObjectId;
  controller: AbortController;
  messages: ReturnType<typeof compactOracleContext>['messages'];
  mode: OracleExecutionMode;
  latestUserText: string;
  groundingText: string;
  grounding: Awaited<ReturnType<typeof buildOracleGrounding>> | {
    citations: [];
    promptContext: string;
    verificationQuestions: [];
  };
  adapter: Awaited<ReturnType<typeof resolveOracleModelAdapter>>;
  model: string;
  estimate: { minMs: number; maxMs: number };
  contextWindow: number;
  maxOutputTokens: number;
  systemPrompt: string;
  includedMessages: number;
  omittedMessages: number;
}) {
  let rawAnswer = '';
  let preparationStartedAt: Date | undefined;
  const onText = async (text: string) => {
    if (!text) return;
    if (!preparationStartedAt) {
      preparationStartedAt = await markAnswerPreparationStarted(input.runId, input.run);
    }
    rawAnswer += text;
  };
  const modelResult = await input.adapter.generate({
    model: input.model,
    signal: input.controller.signal,
    messages: [
      { role: 'system', content: input.systemPrompt },
      {
        role: 'system',
        content: `Runtime metadata: provider=${input.adapter.name}; model=${input.model}. Use this only when the user asks about the active provider or model.`,
      },
      ...(input.grounding.promptContext
        ? [{ role: 'system' as const, content: input.grounding.promptContext }]
        : []),
      ...(input.omittedMessages
        ? [{
          role: 'system' as const,
          content: `${input.omittedMessages} older conversation messages were omitted to keep this request within the model context window. Do not claim to remember their details.`,
        }]
        : []),
      ...input.messages,
    ],
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    onText,
  });
  const finalized = finalizeModelAnswer(rawAnswer);
  if (!finalized.answer.trim()) throw new Error('oracle_model_empty_answer');

  let answer = finalizeGroundedAnswer(finalized.answer, input);
  let repairPromptTokens = 0;
  if (input.mode === 'creative_continuation') {
    const repaired = await repairOracleCreativeAnswerIfNeeded({
      answer,
      adapter: input.adapter,
      model: input.model,
      signal: input.controller.signal,
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      vietnamese: isVietnameseText(input.latestUserText),
    });
    answer = repaired.answer;
    repairPromptTokens = repaired.promptTokens;
  }
  const generatedSuggestions = finalized.suggestions.length
    ? finalized.suggestions
    : await generateFallbackSuggestions({
      adapter: input.adapter,
      model: input.model,
      signal: input.controller.signal,
      userText: input.latestUserText,
      answer,
      languageHint: isVietnameseText(input.latestUserText) ? 'Vietnamese' : 'the user’s language',
    });
  const suggestedPrompts = prioritizeOracleSuggestions({
    answer,
    generated: generatedSuggestions,
    mode: input.mode,
    vietnamese: isVietnameseText(input.latestUserText),
  });
  const compacted = compactUsedCitations(answer, input.grounding.citations);
  answer = compacted.text;
  if (input.mode === 'dream_analysis') {
    await captureOracleEvidenceGaps({
      userId: input.run.userId,
      threadId: input.run.threadId,
      turnId: input.run.assistantTurnId,
      answer,
    });
  }
  return {
    answer,
    citations: compacted.citations,
    suggestedPrompts,
    promptTokens: modelResult.promptTokens + repairPromptTokens,
    contextWindow: input.contextWindow,
    provider: input.adapter.name,
    model: input.model,
    estimate: input.estimate,
    preparationStartedAt,
    includedMessages: input.includedMessages,
    omittedMessages: input.omittedMessages,
  };
}

// Normalize citations and remove unsupported verification boilerplate before persistence.
function finalizeGroundedAnswer(
  rawAnswer: string,
  input: Parameters<typeof generateOracleAnswer>[0],
): string {
  if (input.mode !== 'dream_analysis') return rawAnswer;
  let answer = markUnsupportedInterpretations(rawAnswer);
  answer = validateAcademicCitationSupport(answer, input.grounding.citations);
  answer = sanitizeOracleUnresolvedMarkers(answer);
  if (input.groundingText === input.latestUserText && 'personalContext' in input.grounding) {
    answer = ensurePersonalContextCitation(answer, input.grounding);
  }
  return ensureRuleBackedFinalQuestion(
    answer,
    input.grounding.verificationQuestions,
    isVietnameseText(input.latestUserText),
  );
}

async function markAnswerPreparationStarted(
  runId: Types.ObjectId,
  run: IOracleRun,
): Promise<Date> {
  const startedAt = new Date();
  await OracleRun.updateOne(
    { _id: runId },
    { $set: { stage: 'preparing', stageStartedAt: startedAt } },
  );
  await appendOracleRunEvent(runId, run.threadId, run.userId, 'tool_progress', {
    stage: 'preparing_answer',
    stageStartedAt: startedAt.toISOString(),
  });
  return startedAt;
}

async function publishAnswerEvents(
  runId: Types.ObjectId,
  run: IOracleRun,
  answer: string,
  citations: Awaited<ReturnType<typeof buildOracleGrounding>>['citations'],
): Promise<void> {
  if (answer) {
    await appendOracleRunEvent(runId, run.threadId, run.userId, 'token', { text: answer });
  }
  for (const citation of citations) {
    await appendOracleRunEvent(runId, run.threadId, run.userId, 'citation', { citation });
  }
}
