import type { Request, Response } from 'express';
import {
  parseCreateOracleThreadBody,
  parseOracleThreadListQuery,
  parseOracleThreadReadQuery,
  parseUpdateOracleThreadBody,
} from '../dto/oracleThread.dto';
import { parseOracleObjectId } from '../dto/oracleRequest.dto';
import {
  createOracleThreadRecord,
  deleteOracleThreadRecord,
  getOracleThreadPage,
  listOracleThreadPage,
  updateOracleThreadRecord,
} from '../services/threads/oracleThread.service';
import { oracleRequesterId, sendOracleError } from './oracleHttp.controller';

export async function listOracleThreads(req: Request, res: Response): Promise<void> {
  try {
    const data = await listOracleThreadPage({
      userId: oracleRequesterId(req),
      ...parseOracleThreadListQuery(req.query),
    });
    res.status(200).json({ success: true, ...data });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function createOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const thread = await createOracleThreadRecord({
      userId: oracleRequesterId(req),
      ...parseCreateOracleThreadBody(req.body),
    });
    res.status(201).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const data = await getOracleThreadPage({
      userId: oracleRequesterId(req),
      threadId: parseOracleObjectId(req.params.id),
      ...parseOracleThreadReadQuery(req.query),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function updateOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const thread = await updateOracleThreadRecord({
      userId: oracleRequesterId(req),
      threadId: parseOracleObjectId(req.params.id),
      update: parseUpdateOracleThreadBody(req.body),
    });
    res.status(200).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function deleteOracleThread(req: Request, res: Response): Promise<void> {
  try {
    await deleteOracleThreadRecord(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.id),
    );
    res.status(200).json({ success: true, message: 'Thread deleted.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}
