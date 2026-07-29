import type { Types } from 'mongoose';
import OracleRun from '../../models/OracleRun';
import OracleRunEvent from '../../models/OracleRunEvent';
import { OracleContractError } from '../oracle.types';
import { executeOracleRun } from './oracleRunExecution.service';

export async function getOracleRunRecord(
  userId: Types.ObjectId,
  runId: Types.ObjectId,
) {
  const run = await OracleRun.findOne({ _id: runId, userId })
    .select(
      '_id threadId assistantTurnId status createdAt completedAt '
      + 'expectedMinMs expectedMaxMs stage stageStartedAt errorCode',
    )
    .lean();
  if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
  if (isActiveOracleRun(run.status)) void executeOracleRun(run._id);
  return {
    runId: String(run._id),
    threadId: String(run.threadId),
    assistantTurnId: String(run.assistantTurnId),
    status: run.status,
    startedAt: run.createdAt,
    completedAt: run.completedAt || null,
    expectedMinMs: run.expectedMinMs || null,
    expectedMaxMs: run.expectedMaxMs || null,
    stage: run.stage || 'thinking',
    stageStartedAt: run.stageStartedAt || run.createdAt,
    errorCode: run.errorCode || null,
  };
}

export async function requireOracleRunAccess(
  userId: Types.ObjectId,
  runId: Types.ObjectId,
): Promise<void> {
  const run = await OracleRun.exists({ _id: runId, userId });
  if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
}

export async function readOracleRunEvents(input: {
  userId: Types.ObjectId;
  runId: Types.ObjectId;
  afterSequence: number;
}) {
  return OracleRunEvent.find({
    runId: input.runId,
    userId: input.userId,
    sequence: { $gt: input.afterSequence },
  })
    .sort({ sequence: 1 })
    .limit(100)
    .lean();
}

export async function isOracleRunTerminal(
  userId: Types.ObjectId,
  runId: Types.ObjectId,
): Promise<boolean> {
  const run = await OracleRun.findOne({ _id: runId, userId }).select('status').lean();
  return !run || ['completed', 'failed', 'cancelled'].includes(run.status);
}

function isActiveOracleRun(status: string): boolean {
  return ['initializing', 'queued', 'running'].includes(status);
}
