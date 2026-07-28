import { Request, Response } from 'express';
import { parseOracleCredentialBody } from '../dto/oracleCredential.dto';
import { parseOracleObjectId } from '../dto/oracleRequest.dto';
import {
  activateOracleCredential,
  deleteOracleCredentialRecord,
  listOracleCredentialRecords,
  publicCredential,
  saveOracleCredential,
  verifyOracleCredential,
} from '../services/providers/oracleCredential.service';
import { oracleRequesterId, sendOracleError } from './oracleHttp.controller';

export async function listOracleCredentials(req: Request, res: Response): Promise<void> {
  try {
    const rows = await listOracleCredentialRecords(oracleRequesterId(req));
    res.json({ success: true, data: rows.map(publicCredential) });
  } catch (error) { sendOracleError(res, error); }
}

export async function createOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    const credential = await saveOracleCredential(
      oracleRequesterId(req),
      parseOracleCredentialBody(req.body),
    );
    res.status(201).json({ success: true, data: publicCredential(credential) });
  } catch (error) { sendOracleError(res, error); }
}

export async function testOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    const credential = await verifyOracleCredential(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.id),
    );
    res.json({ success: true, data: publicCredential(credential) });
  } catch (error) { sendOracleError(res, error); }
}

export async function activateOracleCredentialController(req: Request, res: Response): Promise<void> {
  try {
    const credential = await activateOracleCredential(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.id),
    );
    res.json({ success: true, data: publicCredential(credential) });
  } catch (error) { sendOracleError(res, error); }
}

export async function deleteOracleCredential(req: Request, res: Response): Promise<void> {
  try {
    await deleteOracleCredentialRecord(
      oracleRequesterId(req),
      parseOracleObjectId(req.params.id),
    );
    res.json({ success: true });
  } catch (error) { sendOracleError(res, error); }
}
