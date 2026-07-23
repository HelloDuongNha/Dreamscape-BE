import { Request, Response } from 'express';
import { Types } from 'mongoose';
import OracleThread from '../models/OracleThread';
import OracleTurn from '../models/OracleTurn';
import OracleRun from '../models/OracleRun';
import OracleRunEvent from '../models/OracleRunEvent';
import { createOracleTurnRun } from '../services/oracle/oraclePersistence.service';
import { OracleContractError } from '../services/oracle/oracle.types';
import {
  parseClientRequestId,
  parseOracleContent,
  parseOracleMode,
  parseOracleObjectId,
} from '../services/oracle/oracle.validation';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../config/oracleConfig';
import {
  abortOracleRun,
  compactUsedCitations,
  executeOracleRun,
} from '../services/oracle/oracleRun.service';

function requesterId(req: Request): Types.ObjectId {
  if (!req.user?._id) {
    throw new OracleContractError('oracle_not_found', 'Oracle resource was not found.');
  }
  return new Types.ObjectId(String(req.user._id));
}

function sendOracleError(res: Response, error: unknown): void {
  if (error instanceof OracleContractError) {
    const status = error.code === 'oracle_not_found'
      ? 404
      : error.code === 'oracle_idempotency_conflict'
        ? 409
        : error.code === 'oracle_invalid_request'
          ? 400
          : 500;
    res.status(status).json({
      success: false,
      code: error.code,
      message: status === 404
        ? 'Không tìm thấy tài nguyên Oracle.'
        : status === 409
          ? 'Yêu cầu này xung đột với một yêu cầu đã tồn tại.'
          : status === 400
            ? 'Dữ liệu yêu cầu Oracle không hợp lệ.'
            : 'Không thể lưu yêu cầu Oracle.',
    });
    return;
  }
  res.status(500).json({
    success: false,
    code: 'oracle_internal_error',
    message: 'Không thể xử lý yêu cầu Oracle.',
  });
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid pagination limit.');
  }
  return parsed;
}

function deriveThreadTitle(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= 64) return compact;
  const shortened = compact.slice(0, 64);
  const wordBoundary = shortened.lastIndexOf(' ');
  return `${(wordBoundary >= 36 ? shortened.slice(0, wordBoundary) : shortened).trim()}…`;
}

export async function listOracleThreads(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const limit = parseLimit(req.query.limit, 30, 50);
    const beforeId = req.query.beforeId ? parseOracleObjectId(req.query.beforeId) : null;
    const filter: Record<string, unknown> = {
      userId,
      deletedAt: { $exists: false },
      nextTurnSequence: { $gt: 0 },
    };
    if (beforeId) filter._id = { $lt: beforeId };
    const rows = await OracleThread.find(filter)
      .sort({ pinned: -1, lastTurnAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const activeRuns = await OracleRun.find({
      userId,
      threadId: { $in: page.map((thread) => thread._id) },
      status: { $in: ['initializing', 'queued', 'running'] },
    })
      .sort({ createdAt: -1 })
      .select('_id threadId assistantTurnId status createdAt expectedMinMs expectedMaxMs stage stageStartedAt')
      .lean();
    const activeByThread = new Map(
      activeRuns.map((run) => [String(run.threadId), run]),
    );
    const data = page.map((thread) => {
      const activeRun = activeByThread.get(String(thread._id));
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
    });
    res.status(200).json({
      success: true,
      data,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function createOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const mode = parseOracleMode(req.body?.mode ?? 'chat');
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (title.length > 120) {
      throw new OracleContractError('oracle_invalid_request', 'Thread title is too long.');
    }
    const thread = await OracleThread.create({
      userId,
      mode,
      title: title || 'New conversation',
      attachedDreamIds: [],
    });
    res.status(201).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const limit = parseLimit(req.query.limit, 50, 100);
    const beforeSequence = req.query.beforeSequence === undefined
      ? null
      : Number(req.query.beforeSequence);
    if (beforeSequence !== null && (!Number.isInteger(beforeSequence) || beforeSequence < 1)) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid turn cursor.');
    }
    const thread = await OracleThread.findOne({
      _id: threadId,
      userId,
      deletedAt: { $exists: false },
    }).lean();
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');

    const turnFilter: Record<string, unknown> = { threadId, userId };
    if (beforeSequence !== null) turnFilter.sequence = { $lt: beforeSequence };
    const rows = await OracleTurn.find(turnFilter)
      .sort({ sequence: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse().map((turn) => {
      if (turn.role !== 'assistant' || !turn.citations.length) return turn;
      const textBlockIndex = turn.contentBlocks.findIndex((block) => block.type === 'text');
      if (textBlockIndex < 0) return turn;
      const compacted = compactUsedCitations(
        turn.contentBlocks[textBlockIndex].text,
        turn.citations,
      );
      const contentBlocks = turn.contentBlocks.map((block, index) => (
        index === textBlockIndex ? { ...block, text: compacted.text } : block
      ));
      return { ...turn, contentBlocks, citations: compacted.citations };
    });
    res.status(200).json({
      success: true,
      data: {
        thread,
        turns: page,
        nextCursor: hasMore ? page[0]?.sequence ?? null : null,
      },
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function updateOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const update: Record<string, unknown> = {};
    if (req.body?.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 120) {
        throw new OracleContractError('oracle_invalid_request', 'Invalid thread title.');
      }
      update.title = req.body.title.trim();
    }
    if (req.body?.pinned !== undefined) {
      if (typeof req.body.pinned !== 'boolean') throw new OracleContractError('oracle_invalid_request', 'Invalid pinned value.');
      update.pinned = req.body.pinned;
    }
    if (req.body?.archived !== undefined) {
      if (typeof req.body.archived !== 'boolean') throw new OracleContractError('oracle_invalid_request', 'Invalid archived value.');
      update.archived = req.body.archived;
    }
    if (Object.keys(update).length === 0) {
      throw new OracleContractError('oracle_invalid_request', 'No supported thread fields were provided.');
    }
    const thread = await OracleThread.findOneAndUpdate(
      { _id: threadId, userId, deletedAt: { $exists: false } },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
    res.status(200).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function deleteOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const now = new Date();
    const thread = await OracleThread.findOneAndUpdate(
      { _id: threadId, userId, deletedAt: { $exists: false } },
      { $set: { deletedAt: now, archived: true } },
      { new: true },
    );
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');

    const activeRuns = await OracleRun.find({
      threadId,
      userId,
      status: { $in: ['initializing', 'queued', 'running'] },
    }).select('_id');
    const runIds = activeRuns.map((run) => run._id);
    if (runIds.length > 0) {
      await Promise.all([
        OracleRun.updateMany(
          { _id: { $in: runIds }, userId },
          { $set: { status: 'cancelled', completedAt: now, errorCode: 'thread_deleted' } },
        ),
        OracleTurn.updateMany(
          { runId: { $in: runIds }, userId, role: 'assistant', status: { $in: ['queued', 'streaming'] } },
          { $set: { status: 'cancelled', finalizedAt: now } },
        ),
        OracleRunEvent.updateMany(
          { runId: { $in: runIds }, userId },
          { $set: { expiresAt: new Date(now.getTime() + ORACLE_RUN_EVENT_RETENTION_MS) } },
        ),
      ]);
    }
    res.status(200).json({ success: true, message: 'Thread deleted.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function postOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    const content = parseOracleContent(req.body?.content);
    const requestedParentId = req.body?.parentTurnId
      ? parseOracleObjectId(req.body.parentTurnId)
      : null;
    let parentTurnId: Types.ObjectId | undefined;
    if (requestedParentId) {
      const parent = await OracleTurn.findOne({
        _id: requestedParentId,
        threadId,
        userId,
        role: 'assistant',
        status: 'completed',
      }).select('_id');
      if (!parent) throw new OracleContractError('oracle_not_found', 'Oracle parent turn was not found.');
      parentTurnId = parent._id as Types.ObjectId;
    } else {
      const latestAssistant = await OracleTurn.findOne({
        threadId,
        userId,
        role: 'assistant',
        status: 'completed',
      }).sort({ sequence: -1 }).select('_id');
      parentTurnId = latestAssistant?._id as Types.ObjectId | undefined;
    }
    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
      parentTurnId,
    });
    if (!result.replayed) {
      await OracleThread.updateOne(
        { _id: threadId, userId, nextTurnSequence: 2 },
        { $set: { title: deriveThreadTitle(content) } },
      );
      void executeOracleRun(result.runId);
    }
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function branchOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const originalTurnId = parseOracleObjectId(req.params.turnId);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    const content = parseOracleContent(req.body?.content);
    const original = await OracleTurn.findOne({
      _id: originalTurnId,
      threadId,
      userId,
      role: 'user',
      status: 'completed',
    }).select('_id parentTurnId branchRootTurnId');
    if (!original) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');

    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
      parentTurnId: original.parentTurnId,
      branchRootTurnId: original.branchRootTurnId || original._id,
      supersedesTurnId: original._id,
    });
    if (!result.replayed) void executeOracleRun(result.runId);
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function cancelOracleRun(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const now = new Date();
    const run = await OracleRun.findOneAndUpdate(
      { _id: runId, userId, status: { $in: ['initializing', 'queued', 'running'] } },
      { $set: { status: 'cancelled', completedAt: now, errorCode: 'user_cancelled' } },
      { new: true },
    );
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
    abortOracleRun(String(runId));
    await OracleTurn.updateOne(
      { _id: run.assistantTurnId, userId, status: { $in: ['queued', 'streaming'] } },
      { $set: { status: 'cancelled', finalizedAt: now } },
    );
    res.status(200).json({ success: true, message: 'Run cancelled.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleRunStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const run = await OracleRun.findOne({ _id: runId, userId })
      .select(
        '_id threadId assistantTurnId status createdAt completedAt '
        + 'expectedMinMs expectedMaxMs stage stageStartedAt errorCode',
      )
      .lean();
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
    if (['initializing', 'queued', 'running'].includes(run.status)) void executeOracleRun(run._id);
    res.status(200).json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function streamOracleRunEvents(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const afterSequence = req.query.afterSequence === undefined ? 0 : Number(req.query.afterSequence);
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid event cursor.');
    }
    const run = await OracleRun.findOne({ _id: runId, userId }).lean();
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let cursor = afterSequence;
    let closed = false;
    res.on('close', () => { closed = true; });
    const deadline = Date.now() + 25_000;
    while (!closed && Date.now() < deadline) {
      const events = await OracleRunEvent.find({ runId, userId, sequence: { $gt: cursor } })
        .sort({ sequence: 1 })
        .limit(100)
        .lean();
      for (const event of events) {
        cursor = event.sequence;
        res.write(`id: ${event.sequence}\n`);
        res.write(`event: ${event.eventType}\n`);
        res.write(`data: ${JSON.stringify({
          ...(event.payload || {}),
          _eventCreatedAt: event.createdAt,
        })}\n\n`);
      }
      const current = await OracleRun.findOne({ _id: runId, userId }).select('status').lean();
      if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 90));
    }
    if (!closed) res.end();
  } catch (error) {
    if (!res.headersSent) sendOracleError(res, error);
    else res.end();
  }
}
