import crypto from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import OracleRun, { IOracleRun } from '../../models/OracleRun';
import {
  CreateOracleTurnInput,
  OracleContractError,
  OracleTurnRunResult,
} from './oracle.types';

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

  const thread = await OracleThread.findOneAndUpdate(
    { _id: input.threadId, userId: input.userId, deletedAt: { $exists: false } },
    { $inc: { nextTurnSequence: 2 }, $set: { lastTurnAt: new Date() } },
    { new: false, session },
  );
  if (!thread) {
    throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
  }

  const userTurnId = new Types.ObjectId();
  const assistantTurnId = new Types.ObjectId();
  const runId = new Types.ObjectId();
  const userSequence = thread.nextTurnSequence + 1;
  const assistantSequence = userSequence + 1;
  const common = { threadId: input.threadId, userId: input.userId, runId };

  await OracleRun.create([{
    _id: runId,
    ...common,
    clientRequestId: input.clientRequestId,
    requestHash: hash,
    userTurnId,
    assistantTurnId,
    status: 'initializing',
  }], { session });

  await OracleTurn.create([
    {
      _id: userTurnId,
      ...common,
      sequence: userSequence,
      role: 'user',
      status: 'completed',
      contentBlocks: [{ type: 'text', text: input.content }],
      clientRequestId: input.clientRequestId,
      parentTurnId: input.parentTurnId,
      branchRootTurnId: input.branchRootTurnId,
      supersedesTurnId: input.supersedesTurnId,
      finalizedAt: new Date(),
    },
    {
      _id: assistantTurnId,
      ...common,
      sequence: assistantSequence,
      role: 'assistant',
      status: 'queued',
      contentBlocks: [],
      parentTurnId: userTurnId,
      branchRootTurnId: input.branchRootTurnId || userTurnId,
    },
  ], { session });

  const run = await OracleRun.findByIdAndUpdate(
    runId,
    { $set: { status: 'queued' } },
    { new: true, session },
  );
  if (!run) {
    throw new OracleContractError('oracle_persistence_failed', 'Oracle run could not be initialized.');
  }
  return resultFromRun(run, false);
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

export async function createOracleTurnRun(input: CreateOracleTurnInput): Promise<OracleTurnRunResult> {
  const hash = requestHash(input);
  const early = await findIdempotentRun(input, hash);
  if (early) return early;

  if (!await supportsTransactions()) {
    return createWithRaceRecovery(input, hash);
  }

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
