import { OracleContractError } from '../services/oracle.types';
import { parseOracleMode, parseOracleObjectId } from './oracleRequest.dto';

export function parseOracleThreadListQuery(query: Record<string, unknown>) {
  return {
    limit: parseLimit(query.limit, 30, 50),
    beforeId: query.beforeId ? parseOracleObjectId(query.beforeId) : null,
  };
}

export function parseOracleThreadReadQuery(query: Record<string, unknown>) {
  const beforeSequence = query.beforeSequence === undefined
    ? null
    : Number(query.beforeSequence);
  if (beforeSequence !== null && (!Number.isInteger(beforeSequence) || beforeSequence < 1)) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid turn cursor.');
  }
  return {
    limit: parseLimit(query.limit, 50, 100),
    beforeSequence,
  };
}

export function parseCreateOracleThreadBody(body: Record<string, unknown> | undefined) {
  const mode = parseOracleMode(body?.mode ?? 'chat');
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (title.length > 120) {
    throw new OracleContractError('oracle_invalid_request', 'Thread title is too long.');
  }
  return { mode, title: title || 'New conversation' };
}

export function parseUpdateOracleThreadBody(body: Record<string, unknown> | undefined) {
  const update: { title?: string; pinned?: boolean; archived?: boolean } = {};
  if (body?.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid thread title.');
    }
    update.title = body.title.trim();
  }
  if (body?.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') {
      throw new OracleContractError('oracle_invalid_request', 'Invalid pinned value.');
    }
    update.pinned = body.pinned;
  }
  if (body?.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      throw new OracleContractError('oracle_invalid_request', 'Invalid archived value.');
    }
    update.archived = body.archived;
  }
  if (!Object.keys(update).length) {
    throw new OracleContractError('oracle_invalid_request', 'No supported thread fields were provided.');
  }
  return update;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid pagination limit.');
  }
  return parsed;
}
