export interface LogMetadata {
  userId?: string;
  [key: string]: any;
}

const formatLog = (level: 'info' | 'warn' | 'error', message: string, metadata?: LogMetadata): string => {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level,
    message,
    ...metadata,
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
  error: (message: string, error?: any, metadata?: LogMetadata): void => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const payload = {
      ...metadata,
      error: errorMsg,
      stack: errorStack,
    };
    console.error(formatLog('error', message, payload));
  },
};
