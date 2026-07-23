import { Request, Response } from 'express';
import { Types } from 'mongoose';
import OracleModelCredential from '../models/OracleModelCredential';
import { OracleContractError } from '../services/oracle/oracle.types';
import {
  activateOracleCredential,
  publicCredential,
  saveOracleCredential,
  verifyOracleCredential,
} from '../services/oracle/oracleCredential.service';
import { parseOracleObjectId } from '../services/oracle/oracle.validation';

function userId(req: Request): Types.ObjectId {
  if (!req.user?._id) throw new OracleContractError('oracle_not_found', 'Not found.');
  return new Types.ObjectId(String(req.user._id));
}

function fail(res: Response, error: unknown): void {
  if (error instanceof OracleContractError) {
    const status = error.code === 'oracle_not_found'
      ? 404
      : error.code === 'oracle_persistence_failed'
        ? 500
        : 400;
    res.status(status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }
  res.status(500).json({ success: false, code: 'oracle_internal_error', message: 'Unable to update model connection.' });
}

export async function listOracleCredentials(req: Request, res: Response): Promise<void> {
  try {
    const rows = await OracleModelCredential.find({ userId: userId(req) }).sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: rows.map(publicCredential) });
  } catch (error) { fail(res, error); }
}

export async function createOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    const credential = await saveOracleCredential(userId(req), {
      provider: req.body?.provider,
      label: String(req.body?.label || ''),
      baseUrl: String(req.body?.baseUrl || ''),
      modelName: String(req.body?.modelName || ''),
      apiKey: String(req.body?.apiKey || ''),
      privateContextAcknowledged: req.body?.privateContextAcknowledged === true,
    });
    res.status(201).json({ success: true, data: publicCredential(credential) });
  } catch (error) { fail(res, error); }
}

export async function testOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    const credential = await verifyOracleCredential(userId(req), parseOracleObjectId(req.params.id));
    res.json({ success: true, data: publicCredential(credential) });
  } catch (error) { fail(res, error); }
}

export async function activateOracleCredentialController(req: Request, res: Response): Promise<void> {
  try {
    const credential = await activateOracleCredential(userId(req), parseOracleObjectId(req.params.id));
    res.json({ success: true, data: publicCredential(credential) });
  } catch (error) { fail(res, error); }
}

export async function deleteOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    const result = await OracleModelCredential.deleteOne({
      _id: parseOracleObjectId(req.params.id),
      userId: userId(req),
    });
    if (!result.deletedCount) throw new OracleContractError('oracle_not_found', 'Credential not found.');
    res.json({ success: true });
  } catch (error) { fail(res, error); }
}
