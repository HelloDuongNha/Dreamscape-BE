import type { Request, Response } from 'express';
import { parseOracleObjectId } from '../dto/oracleRequest.dto';
import {
  parseBranchOracleTurnBody,
  parseSubmitOracleTurnBody,
} from '../dto/oracleTurn.dto';
import {
  branchOracleTurnRecord,
  submitOracleTurn,
} from '../services/threads/oracleTurnSubmission.service';
import { oracleRequesterId, sendOracleError } from './oracleHttp.controller';

export async function postOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const result = await submitOracleTurn({
      userId: oracleRequesterId(req),
      threadId: parseOracleObjectId(req.params.id),
      ...parseSubmitOracleTurnBody(req.body),
    });
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function branchOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const result = await branchOracleTurnRecord({
      userId: oracleRequesterId(req),
      threadId: parseOracleObjectId(req.params.id),
      originalTurnId: parseOracleObjectId(req.params.turnId),
      ...parseBranchOracleTurnBody(req.body),
    });
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}
