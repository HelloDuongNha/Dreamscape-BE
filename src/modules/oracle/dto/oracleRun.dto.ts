import { OracleContractError } from '../services/oracle.types';

export function parseOracleEventCursor(value: unknown): number {
  if (value === undefined) return 0;
  const cursor = Number(value);
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid event cursor.');
  }
  return cursor;
}
