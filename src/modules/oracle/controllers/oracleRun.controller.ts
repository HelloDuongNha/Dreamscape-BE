import type { Request, Response } from 'express';
import { parseOracleObjectId } from '../dto/oracleRequest.dto';
import { parseOracleEventCursor } from '../dto/oracleRun.dto';
import { cancelOracleRunRecord } from '../services/lifecycle/oracleRunCancellation.service';
import {
  getOracleRunRecord,
  isOracleRunTerminal,
  readOracleRunEvents,
  requireOracleRunAccess,
} from '../services/runs/oracleRunAccess.service';
import { oracleRequesterId, sendOracleError } from './oracleHttp.controller';

export async function cancelOracleRun(req: Request, res: Response): Promise<void> {
  try {
    await cancelOracleRunRecord(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.runId),
    );
    res.status(200).json({ success: true, message: 'Run cancelled.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleRunStatus(req: Request, res: Response): Promise<void> {
  try {
    const data = await getOracleRunRecord(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.runId),
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function streamOracleRunEvents(req: Request, res: Response): Promise<void> {
  try {
    const userId = oracleRequesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    let cursor = parseOracleEventCursor(req.query.afterSequence);
    await requireOracleRunAccess(userId, runId);
    prepareEventStream(res);
    let closed = false;
    res.on('close', () => { closed = true; });
    const deadline = Date.now() + 25_000;
    while (!closed && Date.now() < deadline) {
      const events = await readOracleRunEvents({ userId, runId, afterSequence: cursor });
      for (const event of events) {
        cursor = event.sequence;
        writeOracleEvent(res, event);
      }
      if (await isOracleRunTerminal(userId, runId)) break;
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    if (!closed) res.end();
  } catch (error) {
    if (!res.headersSent) sendOracleError(res, error);
    else res.end();
  }
}

function prepareEventStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function writeOracleEvent(
  res: Response,
  event: Awaited<ReturnType<typeof readOracleRunEvents>>[number],
): void {
  res.write(`id: ${event.sequence}\n`);
  res.write(`event: ${event.eventType}\n`);
  res.write(`data: ${JSON.stringify({
    ...(event.payload || {}),
    _eventCreatedAt: event.createdAt,
  })}\n\n`);
}
