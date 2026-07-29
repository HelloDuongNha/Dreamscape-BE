import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { OracleContractError } from '../services/oracle.types';

export function oracleRequesterId(req: Request): Types.ObjectId {
  if (!req.user?._id) {
    throw new OracleContractError('oracle_not_found', 'Oracle resource was not found.');
  }
  return new Types.ObjectId(String(req.user._id));
}

export function sendOracleError(res: Response, error: unknown): void {
  if (!(error instanceof OracleContractError)) {
    res.status(500).json({
      success: false,
      code: 'oracle_internal_error',
      message: 'Không thể xử lý yêu cầu Oracle.',
    });
    return;
  }
  const status = oracleErrorStatus(error.code);
  res.status(status).json({
    success: false,
    code: error.code,
    message: oracleErrorMessage(status),
    ...(status === 400 ? { reason: error.message } : {}),
  });
}

function oracleErrorStatus(code: string): number {
  if (code === 'oracle_not_found') return 404;
  if (code === 'oracle_idempotency_conflict') return 409;
  if (code === 'oracle_invalid_request') return 400;
  return 500;
}

function oracleErrorMessage(status: number): string {
  if (status === 404) return 'Không tìm thấy tài nguyên Oracle.';
  if (status === 409) return 'Yêu cầu này xung đột với một yêu cầu đã tồn tại.';
  if (status === 400) return 'Dữ liệu yêu cầu Oracle không hợp lệ.';
  return 'Không thể lưu yêu cầu Oracle.';
}
