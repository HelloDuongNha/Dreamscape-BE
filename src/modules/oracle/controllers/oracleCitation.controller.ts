import type { Request, Response } from 'express';
import {
  parseExpectedOracleSourceId,
  parseOracleCitationFeedbackBody,
  parseOracleCitationIndex,
} from '../dto/oracleCitation.dto';
import { parseOracleObjectId } from '../dto/oracleRequest.dto';
import {
  submitOracleCitationFeedbackRecord,
} from '../services/grounding/oracleCitationFeedback.service';
import {
  getOracleCitationDetailsRecord,
} from '../services/grounding/oracleCitationDetails.service';
import { oracleRequesterId, sendOracleError } from './oracleHttp.controller';

export async function submitOracleCitationFeedback(req: Request, res: Response): Promise<void> {
  try {
    const data = await submitOracleCitationFeedbackRecord({
      userId: oracleRequesterId(req),
      turnId: parseOracleObjectId(req.params.turnId),
      citationIndex: parseOracleCitationIndex(req.params.index),
      expectedSourceId: parseExpectedOracleSourceId(req.query.sourceId),
      ...parseOracleCitationFeedbackBody(req.body),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleCitationDetails(req: Request, res: Response): Promise<void> {
  try {
    const data = await getOracleCitationDetailsRecord({
      userId: oracleRequesterId(req),
      turnId: parseOracleObjectId(req.params.turnId),
      citationIndex: parseOracleCitationIndex(req.params.index),
      expectedSourceId: parseExpectedOracleSourceId(req.query.sourceId),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendOracleError(res, error);
  }
}
