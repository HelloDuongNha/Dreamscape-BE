import type { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logger';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import { OracleContractError } from '../oracle.types';
import { createOracleTurnRun } from '../persistence/oracleTurnRunPersistence.service';
import { executeOracleRun } from '../runs/oracleRunExecution.service';
import { applyOracleReplyValidation } from '../grounding/oracleReplyValidation.service';

export async function submitOracleTurn(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  clientRequestId: string;
  content: string;
  requestedParentId: Types.ObjectId | null;
}) {
  const parentTurnId = await resolveParentTurn(input);
  const result = await createOracleTurnRun({
    userId: input.userId,
    threadId: input.threadId,
    clientRequestId: input.clientRequestId,
    content: input.content,
    parentTurnId,
  });
  if (result.replayed) return result;
  await applyReplyValidationSafely(input, parentTurnId);
  await OracleThread.updateOne(
    { _id: input.threadId, userId: input.userId, nextTurnSequence: 2 },
    { $set: { title: deriveThreadTitle(input.content) } },
  );
  void executeOracleRun(result.runId);
  return result;
}

export async function branchOracleTurnRecord(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  originalTurnId: Types.ObjectId;
  clientRequestId: string;
  content: string;
}) {
  const original = await OracleTurn.findOne({
    _id: input.originalTurnId,
    threadId: input.threadId,
    userId: input.userId,
    role: 'user',
    status: 'completed',
  }).select('_id parentTurnId branchRootTurnId');
  if (!original) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');
  const result = await createOracleTurnRun({
    userId: input.userId,
    threadId: input.threadId,
    clientRequestId: input.clientRequestId,
    content: input.content,
    parentTurnId: original.parentTurnId,
    branchRootTurnId: original.branchRootTurnId || original._id,
    supersedesTurnId: original._id,
  });
  if (!result.replayed) void executeOracleRun(result.runId);
  return result;
}

async function resolveParentTurn(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  requestedParentId: Types.ObjectId | null;
}): Promise<Types.ObjectId | undefined> {
  if (input.requestedParentId) {
    const parent = await OracleTurn.findOne({
      _id: input.requestedParentId,
      threadId: input.threadId,
      userId: input.userId,
      role: 'assistant',
      status: 'completed',
    }).select('_id');
    if (!parent) throw new OracleContractError('oracle_not_found', 'Oracle parent turn was not found.');
    return parent._id as Types.ObjectId;
  }
  const latest = await OracleTurn.findOne({
    threadId: input.threadId,
    userId: input.userId,
    role: 'assistant',
    status: 'completed',
  }).sort({ sequence: -1 }).select('_id');
  return latest?._id as Types.ObjectId | undefined;
}

async function applyReplyValidationSafely(
  input: { userId: Types.ObjectId; threadId: Types.ObjectId; content: string },
  parentTurnId: Types.ObjectId | undefined,
): Promise<void> {
  try {
    await applyOracleReplyValidation(input.userId, parentTurnId, input.content);
  } catch (error) {
    logger.warn('Oracle reply validation could not update the argument score.', {
      error: String(error),
      threadId: String(input.threadId),
      parentTurnId: parentTurnId ? String(parentTurnId) : null,
    });
  }
}

function deriveThreadTitle(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= 64) return compact;
  const shortened = compact.slice(0, 64);
  const wordBoundary = shortened.lastIndexOf(' ');
  return `${(wordBoundary >= 36 ? shortened.slice(0, wordBoundary) : shortened).trim()}…`;
}
