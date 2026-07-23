export function isOracleFeatureEnabled(value = process.env.FEATURE_ORACLE_ENABLED): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export const ORACLE_RUN_EVENT_RETENTION_MS = 48 * 60 * 60 * 1000;
