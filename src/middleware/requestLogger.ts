import { Request, Response, NextFunction } from 'express';

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
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
};

export default requestLogger;
