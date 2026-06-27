import { Request, Response, NextFunction } from 'express';

/**
 * Global error-handling middleware.
 * Must be registered last (after all routes) in app.ts.
 */
const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error('🔥 Unhandled Error:', err.message);

  res.status(500).json({
    success: false,
    message: err.message ?? 'Internal Server Error',
  });
};

export default errorHandler;
