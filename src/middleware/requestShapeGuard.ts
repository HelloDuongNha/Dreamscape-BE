import type { NextFunction, Request, Response } from 'express';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_INSPECTION_DEPTH = 20;

// Reject Mongo operators and prototype-pollution keys before DTO parsing.
export default function requestShapeGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const invalidPath = findInvalidKey(
    { body: req.body, query: req.query, params: req.params },
    '',
    0,
    new WeakSet<object>(),
  );
  if (!invalidPath) {
    next();
    return;
  }

  res.status(400).json({
    success: false,
    code: 'invalid_request_shape',
    message: 'Request contains an unsupported field name.',
  });
}

function findInvalidKey(
  value: unknown,
  path: string,
  depth: number,
  visited: WeakSet<object>,
): string | null {
  if (!value || typeof value !== 'object' || depth > MAX_INSPECTION_DEPTH) return null;
  if (visited.has(value)) return null;
  visited.add(value);

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key)) return childPath;
    const nested = findInvalidKey(child, childPath, depth + 1, visited);
    if (nested) return nested;
  }
  return null;
}
