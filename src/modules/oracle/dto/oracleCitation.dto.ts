import { OracleContractError } from '../services/oracle.types';

export function parseOracleCitationIndex(value: unknown): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid citation index.');
  }
  return index;
}

export function parseOracleCitationFeedbackBody(body: Record<string, unknown> | undefined) {
  const ruleId = String(body?.ruleId || '').trim();
  const answer = body?.answer === null
    ? null
    : String(body?.answer || '').trim() as 'yes' | 'no' | 'unsure';
  if (!ruleId) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid citation feedback target.');
  }
  if (answer !== null && !['yes', 'no', 'unsure'].includes(answer)) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid citation feedback answer.');
  }
  return { ruleId, answer };
}

export function parseExpectedOracleSourceId(value: unknown): string {
  return String(value || '').trim();
}
