import { Request, Response } from 'express';
import { listOracleEvidenceGapRecords } from '../services/evidence/oracleEvidenceGapRead.service';

export async function listOracleEvidenceGaps(req: Request, res: Response): Promise<void> {
  const requestedStatus = String(req.query.status || 'active');
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
  const data = await listOracleEvidenceGapRecords({
    status: requestedStatus,
    page,
    limit,
  });
  res.status(200).json({
    success: true,
    data,
  });
}
