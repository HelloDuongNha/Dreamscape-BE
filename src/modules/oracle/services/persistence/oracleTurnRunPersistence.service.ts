import crypto from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import OracleRun, { IOracleRun } from '../../models/OracleRun';
import {
  CreateOracleTurnInput,
  OracleContractError,
  OracleTurnRunResult,
} from '../oracle.types';

export async function createOracleTurnRun(input: CreateOracleTurnInput): Promise<OracleTurnRunResult> {
  const hash = requestHash(input);
  const replay = await findIdempotentRun(input, hash);
  if (replay) return replay;
  if (!await supportsTransactions()) return createWithRaceRecovery(input, hash);
  return createTransactionalTurnRun(input, hash);
}

function requestHash(input: CreateOracleTurnInput): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      threadId: input.threadId.toHexString(),
      content: input.content,
      parentTurnId: input.parentTurnId?.toHexString() || null,
      supersedesTurnId: input.supersedesTurnId?.toHexString() || null,
    }))
    .digest('hex');
}

function resultFromRun(run: IOracleRun, replayed: boolean): OracleTurnRunResult {
  return {
    userTurnId: run.userTurnId,
    assistantTurnId: run.assistantTurnId,
    runId: run._id as Types.ObjectId,
    status: run.status,
    replayed,
  };
}

async function findIdempotentRun(
  input: CreateOracleTurnInput,
  hash: string,
  session?: ClientSession,
): Promise<OracleTurnRunResult | null> {
  const query = OracleRun.findOne({
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
  if (session) query.session(session);
  const existing = await query;
  if (!existing) return null;
  if (!existing.threadId.equals(input.threadId) || existing.requestHash !== hash) {
    throw new OracleContractError(
      'oracle_idempotency_conflict',
      'The client request identifier was already used for a different request.',
    );
  }
  return resultFromRun(existing, true);
}

async function createWithinSession(
  input: CreateOracleTurnInput,
  hash: string,
  session?: ClientSession,
): Promise<OracleTurnRunResult> {
  const existing = await findIdempotentRun(input, hash, session);
  if (existing) return existing;

  const sequences = await reserveTurnSequences(input, session);
  const userTurnId = new Types.ObjectId();
  const assistantTurnId = new Types.ObjectId();
  const runId = new Types.ObjectId();

  await createInitializingRun(input, hash, { runId, userTurnId, assistantTurnId }, session);
  await createTurnPair(
    input,
    { runId, userTurnId, assistantTurnId, ...sequences },
    session,
  );
  const run = await markRunQueued(runId, session);
  return resultFromRun(run, false);
}

async function reserveTurnSequences(
  input: CreateOracleTurnInput,
  session?: ClientSession,
): Promise<{ userSequence: number; assistantSequence: number }> {
  const thread = await OracleThread.findOneAndUpdate(
    { _id: input.threadId, userId: input.userId, deletedAt: { $exists: false } },
    { $inc: { nextTurnSequence: 2 }, $set: { lastTurnAt: new Date() } },
    { returnDocument: 'before', session },
  );
  if (!thread) {
    throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
  }
  return {
    userSequence: thread.nextTurnSequence + 1,
    assistantSequence: thread.nextTurnSequence + 2,
  };
}

async function createInitializingRun(
  input: CreateOracleTurnInput,
  hash: string,
  ids: { runId: Types.ObjectId; userTurnId: Types.ObjectId; assistantTurnId: Types.ObjectId },
  session?: ClientSession,
): Promise<void> {
  await OracleRun.create([{
    _id: ids.runId,
    threadId: input.threadId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    requestHash: hash,
    userTurnId: ids.userTurnId,
    assistantTurnId: ids.assistantTurnId,
    status: 'initializing',
  }], { session });
}

async function createTurnPair(
  input: CreateOracleTurnInput,
  records: {
    runId: Types.ObjectId;
    userTurnId: Types.ObjectId;
    assistantTurnId: Types.ObjectId;
    userSequence: number;
    assistantSequence: number;
  },
  session?: ClientSession,
): Promise<void> {
  const common = { threadId: input.threadId, userId: input.userId, runId: records.runId };
  await OracleTurn.create([
    {
      _id: records.userTurnId,
      ...common,
      sequence: records.userSequence,
      role: 'user',
      status: 'completed',
      contentBlocks: [{ type: 'text', text: input.content }],
      clientRequestId: input.clientRequestId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      ...(input.branchRootTurnId ? { branchRootTurnId: input.branchRootTurnId } : {}),
      ...(input.supersedesTurnId ? { supersedesTurnId: input.supersedesTurnId } : {}),
      finalizedAt: new Date(),
    },
    {
      _id: records.assistantTurnId,
      ...common,
      sequence: records.assistantSequence,
      role: 'assistant',
      status: 'queued',
      contentBlocks: [],
      parentTurnId: records.userTurnId,
      branchRootTurnId: input.branchRootTurnId || records.userTurnId,
    },
  ], { session, ordered: true });
}

async function markRunQueued(runId: Types.ObjectId, session?: ClientSession): Promise<IOracleRun> {
  const run = await OracleRun.findByIdAndUpdate(
    runId,
    { $set: { status: 'queued' } },
    { returnDocument: 'after', session },
  );
  if (!run) {
    throw new OracleContractError('oracle_persistence_failed', 'Oracle run could not be initialized.');
  }
  return run;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
}

async function supportsTransactions(): Promise<boolean> {
  try {
    const hello = await mongoose.connection.db?.command({ hello: 1 });
    return Boolean(hello && (hello.setName || hello.msg === 'isdbgrid'));
  } catch {
    return false;
  }
}

async function createWithRaceRecovery(
  input: CreateOracleTurnInput,
  hash: string,
  session?: ClientSession,
): Promise<OracleTurnRunResult> {
  try {
    return await createWithinSession(input, hash, session);
  } catch (error) {
    if (isDuplicateKey(error)) {
      const replay = await findIdempotentRun(input, hash);
      if (replay) return replay;
    }
    throw error;
  }
}

async function createTransactionalTurnRun(
  input: CreateOracleTurnInput,
  hash: string,
): Promise<OracleTurnRunResult> {
  const session = await mongoose.startSession();
  try {
    let result: OracleTurnRunResult | undefined;
    await session.withTransaction(async () => {
      result = await createWithRaceRecovery(input, hash, session);
    });
    if (!result) {
      throw new OracleContractError('oracle_persistence_failed', 'Oracle transaction produced no result.');
    }
    return result;
  } finally {
    await session.endSession();
  }
}
