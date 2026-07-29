import type { Types } from 'mongoose';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../../../../config/oracleConfig';
import OracleRun from '../../models/OracleRun';
import OracleRunEvent from '../../models/OracleRunEvent';
import OracleTurn from '../../models/OracleTurn';
import { OracleContractError } from '../oracle.types';
import { abortOracleRun } from '../runs/oracleRunExecution.service';

const ACTIVE_RUN_STATUSES = ['initializing', 'queued', 'running'] as const;
const ACTIVE_ASSISTANT_STATUSES = ['queued', 'streaming'] as const;

export async function cancelOracleRunRecord(
  userId: Types.ObjectId,
  runId: Types.ObjectId,
): Promise<void> {
  const now = new Date();
  const run = await markRunCancelled(userId, runId, now);
  if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
  abortOracleRun(String(runId));
  await markAssistantTurnCancelled(userId, run.assistantTurnId, now);
}

export async function cancelOracleThreadRuns(
  userId: Types.ObjectId,
  threadId: Types.ObjectId,
  now: Date,
): Promise<void> {
  const activeRuns = await OracleRun.find({
    threadId,
    userId,
    status: { $in: ACTIVE_RUN_STATUSES },
  }).select('_id');
  const runIds = activeRuns.map((run) => run._id);
  if (!runIds.length) return;

  runIds.forEach((runId) => abortOracleRun(String(runId)));
  await Promise.all([
    OracleRun.updateMany(
      { _id: { $in: runIds }, userId },
      { $set: { status: 'cancelled', completedAt: now, errorCode: 'thread_deleted' } },
    ),
    OracleTurn.updateMany(
      {
        runId: { $in: runIds },
        userId,
        role: 'assistant',
        status: { $in: ACTIVE_ASSISTANT_STATUSES },
      },
      { $set: { status: 'cancelled', finalizedAt: now } },
    ),
    OracleRunEvent.updateMany(
      { runId: { $in: runIds }, userId },
      { $set: { expiresAt: new Date(now.getTime() + ORACLE_RUN_EVENT_RETENTION_MS) } },
    ),
  ]);
}

function markRunCancelled(userId: Types.ObjectId, runId: Types.ObjectId, now: Date) {
  return OracleRun.findOneAndUpdate(
    { _id: runId, userId, status: { $in: ACTIVE_RUN_STATUSES } },
    { $set: { status: 'cancelled', completedAt: now, errorCode: 'user_cancelled' } },
    { new: true },
  );
}

function markAssistantTurnCancelled(
  userId: Types.ObjectId,
  assistantTurnId: Types.ObjectId,
  now: Date,
) {
  return OracleTurn.updateOne(
    { _id: assistantTurnId, userId, status: { $in: ACTIVE_ASSISTANT_STATUSES } },
    { $set: { status: 'cancelled', finalizedAt: now } },
  );
}
