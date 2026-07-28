import type { Types } from 'mongoose';
import OracleRun from '../../models/OracleRun';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import { removeRuleValidationFeedbackForOrigins } from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import { OracleContractError, type OracleMode } from '../oracle.types';
import { removeEvidenceOccurrences } from '../evidence/oracleEvidenceLifecycle.service';
import { cancelOracleThreadRuns } from '../lifecycle/oracleRunCancellation.service';
import { executeOracleRun } from '../runs/oracleRunExecution.service';

export async function listOracleThreadPage(input: {
  userId: Types.ObjectId;
  limit: number;
  beforeId: Types.ObjectId | null;
}) {
  const filter: Record<string, unknown> = {
    userId: input.userId,
    deletedAt: { $exists: false },
    nextTurnSequence: { $gt: 0 },
  };
  if (input.beforeId) filter._id = { $lt: input.beforeId };
  const rows = await OracleThread.find(filter)
    .sort({ pinned: -1, lastTurnAt: -1, _id: -1 })
    .limit(input.limit + 1)
    .lean();
  const page = rows.slice(0, input.limit);
  const activeRuns = await OracleRun.find({
    userId: input.userId,
    threadId: { $in: page.map((thread) => thread._id) },
    status: { $in: ['initializing', 'queued', 'running'] },
  })
    .sort({ createdAt: -1 })
    .select('_id threadId assistantTurnId status createdAt expectedMinMs expectedMaxMs stage stageStartedAt')
    .lean();
  const activeByThread = new Map(activeRuns.map((run) => [String(run.threadId), run]));
  return {
    data: page.map((thread) => presentThreadWithRun(thread, activeByThread.get(String(thread._id)))),
    nextCursor: rows.length > input.limit ? String(page[page.length - 1]._id) : null,
  };
}

export async function createOracleThreadRecord(input: {
  userId: Types.ObjectId;
  mode: OracleMode;
  title: string;
}) {
  return OracleThread.create({
    userId: input.userId,
    mode: input.mode,
    title: input.title,
    attachedDreamIds: [],
  });
}

export async function getOracleThreadPage(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  limit: number;
  beforeSequence: number | null;
}) {
  const thread = await OracleThread.findOne({
    _id: input.threadId,
    userId: input.userId,
    deletedAt: { $exists: false },
  }).lean();
  if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
  const filter: Record<string, unknown> = {
    threadId: input.threadId,
    userId: input.userId,
  };
  if (input.beforeSequence !== null) filter.sequence = { $lt: input.beforeSequence };
  const rows = await OracleTurn.find(filter)
    .sort({ sequence: -1 })
    .limit(input.limit + 1)
    .lean();
  const page = rows.slice(0, input.limit).reverse();
  return {
    thread,
    turns: page,
    nextCursor: rows.length > input.limit ? page[0]?.sequence ?? null : null,
  };
}

export async function updateOracleThreadRecord(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  update: { title?: string; pinned?: boolean; archived?: boolean };
}) {
  const thread = await OracleThread.findOneAndUpdate(
    { _id: input.threadId, userId: input.userId, deletedAt: { $exists: false } },
    { $set: input.update },
    { new: true, runValidators: true },
  );
  if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
  return thread;
}

export async function deleteOracleThreadRecord(
  userId: Types.ObjectId,
  threadId: Types.ObjectId,
): Promise<void> {
  const now = new Date();
  const thread = await OracleThread.findOneAndUpdate(
    { _id: threadId, userId, deletedAt: { $exists: false } },
    { $set: { deletedAt: now, archived: true } },
    { new: true },
  );
  if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
  await cancelOracleThreadRuns(userId, threadId, now);
  const turns = await OracleTurn.find({ userId, threadId }).select('_id').lean();
  const turnIds = turns.map((turn) => turn._id as Types.ObjectId);
  await Promise.all([
    removeEvidenceOccurrences({ turnIds }),
    removeRuleValidationFeedbackForOrigins({ origin: 'oracle', originIds: turnIds }),
  ]);
}

function presentThreadWithRun(thread: any, activeRun: any) {
  if (activeRun) void executeOracleRun(activeRun._id);
  return {
    ...thread,
    activeRunId: activeRun ? String(activeRun._id) : null,
    activeRunStatus: activeRun?.status || null,
    activeRunStartedAt: activeRun?.createdAt || null,
    activeRunAssistantTurnId: activeRun ? String(activeRun.assistantTurnId) : null,
    activeRunExpectedMinMs: activeRun?.expectedMinMs || null,
    activeRunExpectedMaxMs: activeRun?.expectedMaxMs || null,
    activeRunStage: activeRun?.stage || 'thinking',
    activeRunStageStartedAt: activeRun?.stageStartedAt || activeRun?.createdAt || null,
  };
}
