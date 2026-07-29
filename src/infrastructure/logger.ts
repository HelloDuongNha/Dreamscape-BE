import { sanitizeLogText, sanitizeLogValue } from './logSanitizer';

export interface LogMetadata {
  userId?: string;
  [key: string]: unknown;
}

const formatLog = (level: 'info' | 'warn' | 'error', message: string, metadata?: LogMetadata): string => {
  const timestamp = new Date().toISOString();
  const safeMetadata = sanitizeLogValue(metadata) as LogMetadata | undefined;
  const payload = {
    timestamp,
    level,
    message: sanitizeLogText(message),
    ...safeMetadata,
  };
  return JSON.stringify(payload);
};

export const logger = {
  info: (message: string, metadata?: LogMetadata): void => {
    console.log(formatLog('info', message, metadata));
  },
  warn: (message: string, metadata?: LogMetadata): void => {
    console.warn(formatLog('warn', message, metadata));
  },
  error: (message: string, error?: unknown, metadata?: LogMetadata): void => {
    const errorDetails = error === undefined ? undefined : sanitizeLogValue(error);
    const payload = {
      ...metadata,
      error: errorDetails,
    };
    console.error(formatLog('error', message, payload));
  },
};
