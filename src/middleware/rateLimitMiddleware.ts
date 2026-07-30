import crypto from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getRedisClient, getRedisHealth, redisKey } from '../infrastructure/redis/redisConnection';
import { logger } from '../infrastructure/logger';

export interface RateLimitPolicy {
  scope: string;
  limit: number;
  windowMs: number;
  keyBy?: 'ip' | 'ip-and-email';
}

interface RateLimitState {
  count: number;
  resetAt: number;
}

const memoryWindows = new Map<string, RateLimitState>();
const MAX_MEMORY_WINDOWS = 10_000;
let lastRedisFallbackWarningAt = 0;

const REDIS_FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

// Enforce a fixed-window limit with Redis and an in-process fallback.
export function createRateLimitMiddleware(policy: RateLimitPolicy): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const key = buildRateLimitKey(policy.scope, requestIdentity(req, policy));
    const state = await consumeWindow(key, policy);
    const remaining = Math.max(0, policy.limit - state.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));

    res.setHeader('RateLimit-Limit', String(policy.limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(state.resetAt / 1000)));

    if (state.count <= policy.limit) {
      next();
      return;
    }

    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      code: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfterSeconds,
    });
  };
}

function requestIdentity(req: Request, policy: RateLimitPolicy): string {
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
  if (policy.keyBy !== 'ip-and-email') return ipAddress;
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : 'email-unavailable';
  return `${ipAddress}:${email}`;
}

async function consumeWindow(key: string, policy: RateLimitPolicy): Promise<RateLimitState> {
  if (getRedisHealth().ready) {
    try {
      const result = await getRedisClient().eval(REDIS_FIXED_WINDOW_SCRIPT, {
        keys: [redisKey(`rate-limit:${key}`)],
        arguments: [String(policy.windowMs)],
      }) as [number, number];
      const ttl = Math.max(1, Number(result[1]) || policy.windowMs);
      return { count: Number(result[0]) || 1, resetAt: Date.now() + ttl };
    } catch (error) {
      warnRedisFallback(error);
    }
  }
  return consumeMemoryWindow(key, policy.windowMs);
}

function consumeMemoryWindow(key: string, windowMs: number): RateLimitState {
  const now = Date.now();
  const current = memoryWindows.get(key);
  if (!current || current.resetAt <= now) {
    const created = { count: 1, resetAt: now + windowMs };
    memoryWindows.set(key, created);
    pruneExpiredMemoryWindows(now);
    return created;
  }
  current.count += 1;
  return current;
}

function buildRateLimitKey(scope: string, identity: string): string {
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `${scope}:${digest}`;
}

function pruneExpiredMemoryWindows(now: number): void {
  if (memoryWindows.size < 2_000) return;
  for (const [key, state] of memoryWindows) {
    if (state.resetAt <= now) memoryWindows.delete(key);
  }
  while (memoryWindows.size > MAX_MEMORY_WINDOWS) {
    const oldestKey = memoryWindows.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryWindows.delete(oldestKey);
  }
}

function warnRedisFallback(error: unknown): void {
  const now = Date.now();
  if (now - lastRedisFallbackWarningAt < 60_000) return;
  lastRedisFallbackWarningAt = now;
  logger.warn('Rate limiter is using the in-process fallback.', {
    reason: error instanceof Error ? error.message : 'redis_command_failed',
  });
}
