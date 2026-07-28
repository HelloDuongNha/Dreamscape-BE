import { Types } from 'mongoose';
import OracleRun, { type IOracleRun } from '../../models/OracleRun';
import OracleRunEvent from '../../models/OracleRunEvent';
import OracleTurn from '../../models/OracleTurn';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../../../../config/oracleConfig';
import type { OracleCitation } from '../oracle.types';
import { appendOracleRunEvent } from '../runs/oracleRunEvent.service';

interface CompleteOracleRunInput {
  run: IOracleRun;
  runId: Types.ObjectId;
  answer: string;
  citations: OracleCitation[];
  suggestedPrompts: string[];
  promptTokens: number;
  contextWindow: number;
  provider: string;
  modelName: string;
  preparationStartedAt?: Date;
  expectedMinMs: number;
  expectedMaxMs: number;
}

export async function completeOracleRun(input: CompleteOracleRunInput): Promise<void> {
  const now = new Date();
  const contextUsage = buildContextUsage(input);
  await persistAssistantResult(input, now, contextUsage);
  await publishCompletedEvent(input, now, contextUsage);
  await persistCompletedRun(input, now);
  await retainRunEvents(input.runId, input.run.userId, now);
}

export async function failOracleRun(input: {
  run: IOracleRun;
  runId: Types.ObjectId;
  partialAnswer: string;
  cancelled: boolean;
}): Promise<void> {
  const now = new Date();
  const status = input.cancelled ? 'cancelled' : 'failed';
  const errorCode = input.cancelled ? 'user_cancelled' : 'oracle_model_unavailable';
  await persistFailedRun(input, now, status, errorCode);
  await appendOracleRunEvent(
    input.runId,
    input.run.threadId,
    input.run.userId,
    input.cancelled ? 'cancelled' : 'error',
    { code: errorCode },
  );
}

function buildContextUsage(input: CompleteOracleRunInput) {
  return {
    usedTokens: input.promptTokens,
    maxTokens: input.contextWindow,
    percent: Math.min(100, Math.round((input.promptTokens / input.contextWindow) * 100)),
    provider: input.provider,
    modelName: input.modelName,
  };
}

async function persistAssistantResult(
  input: CompleteOracleRunInput,
  now: Date,
  contextUsage: ReturnType<typeof buildContextUsage>,
): Promise<void> {
  await OracleTurn.updateOne(
    { _id: input.run.assistantTurnId },
    {
      $set: {
        status: 'completed',
        contentBlocks: [{ type: 'text', text: input.answer }],
        citations: input.citations,
        suggestedPrompts: input.suggestedPrompts,
        contextUsage,
        runTiming: {
          startedAt: input.run.createdAt,
          thoughtCompletedAt: input.preparationStartedAt || now,
          completedAt: now,
          expectedMinMs: input.expectedMinMs,
          expectedMaxMs: input.expectedMaxMs,
        },
        finalizedAt: now,
      },
    },
  );
}

async function publishCompletedEvent(
  input: CompleteOracleRunInput,
  now: Date,
  contextUsage: ReturnType<typeof buildContextUsage>,
): Promise<void> {
  await appendOracleRunEvent(
    input.runId,
    input.run.threadId,
    input.run.userId,
    'done',
    {
      assistantTurnId: String(input.run.assistantTurnId),
      completedAt: now.toISOString(),
      suggestedPrompts: input.suggestedPrompts,
      contextUsage,
    },
  );
}

async function persistCompletedRun(input: CompleteOracleRunInput, now: Date): Promise<void> {
  await OracleRun.updateOne(
    { _id: input.runId },
    {
      $set: {
        status: 'completed',
        completedAt: now,
        durationMs: Math.max(0, now.getTime() - input.run.createdAt.getTime()),
        outputChars: input.answer.length,
        promptTokens: input.promptTokens,
        stage: 'completed',
        stageStartedAt: now,
      },
    },
  );
}

async function retainRunEvents(
  runId: Types.ObjectId,
  userId: Types.ObjectId,
  now: Date,
): Promise<void> {
  await OracleRunEvent.updateMany(
    { runId, userId },
    { $set: { expiresAt: new Date(now.getTime() + ORACLE_RUN_EVENT_RETENTION_MS) } },
  );
}

async function persistFailedRun(input: {
  run: IOracleRun;
  runId: Types.ObjectId;
  partialAnswer: string;
  cancelled: boolean;
}, now: Date, status: 'cancelled' | 'failed', errorCode: string): Promise<void> {
  await Promise.all([
    OracleTurn.updateOne(
      { _id: input.run.assistantTurnId },
      {
        $set: {
          status,
          finalizedAt: now,
          ...(input.partialAnswer
            ? { contentBlocks: [{ type: 'text', text: input.partialAnswer }] }
            : {}),
        },
      },
    ),
    OracleRun.updateOne(
      { _id: input.runId },
      { $set: { status, completedAt: now, errorCode } },
    ),
  ]);
}
