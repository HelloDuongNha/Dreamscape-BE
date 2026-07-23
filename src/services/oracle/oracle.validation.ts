import { Types } from 'mongoose';
import type { OracleMode } from './oracle.types';
import { OracleContractError } from './oracle.types';

const MODES = new Set<OracleMode>(['chat', 'dream_analysis', 'creative_continuation']);
const CLIENT_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function parseOracleObjectId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid identifier.');
  }
  return new Types.ObjectId(value);
}

export function parseOracleMode(value: unknown): OracleMode {
  if (typeof value !== 'string' || !MODES.has(value as OracleMode)) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid Oracle mode.');
  }
  return value as OracleMode;
}

export function parseClientRequestId(value: unknown): string {
  if (typeof value !== 'string' || !CLIENT_REQUEST_ID.test(value)) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid client request identifier.');
  }
  return value;
}

export function parseOracleContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OracleContractError('oracle_invalid_request', 'Message content must be a string.');
  }
  const content = value.trim();
  if (!content || Buffer.byteLength(content, 'utf8') > 20_000) {
    throw new OracleContractError('oracle_invalid_request', 'Message content is empty or too large.');
  }
  return content;
}
