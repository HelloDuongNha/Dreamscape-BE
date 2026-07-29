import { Request, Response, NextFunction } from 'express';
import { logger } from '../infrastructure/logger';

/**
 * Simple request logger middleware.
 * Logs method, URL, status code, and response time for every request.
 */
const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    // Query strings may contain recovery codes or provider tokens, so request
    // telemetry records only the matched path.
    logger.info('HTTP request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
};

export default requestLogger;
