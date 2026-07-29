import { createClient, type RedisClientType } from 'redis';
import { logger } from '../logger';

export type RedisConnectionState =
  | 'disabled'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'closed';

export interface RedisHealth {
  configured: boolean;
  required: boolean;
  state: RedisConnectionState;
  ready: boolean;
}

let redisClient: RedisClientType | null = null;
let connectionState: RedisConnectionState = 'disabled';

/**
 * Opens the shared Redis connection once during server startup.
 *
 * REDIS_REQUIRED controls the failure boundary: local development can continue
 * without Redis while no production queue depends on it, whereas a future
 * Redis-backed deployment can fail fast instead of silently losing jobs.
 */
export async function initializeRedis(): Promise<RedisHealth> {
  const url = process.env.REDIS_URL?.trim();
  const required = redisRequired();

  if (!url) {
    connectionState = 'disabled';
    if (required) {
      throw new Error('REDIS_URL is required when REDIS_REQUIRED=true.');
    }
    logger.info('Redis is not configured; Redis-backed features are disabled.');
    return getRedisHealth();
  }

  if (redisClient?.isReady) return getRedisHealth();

  connectionState = 'connecting';
  redisClient = createClient({
    url,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: retries => {
        const jitter = Math.floor(Math.random() * 100);
        return Math.min(2 ** retries * 50, 3_000) + jitter;
      },
    },
  });

  redisClient.on('ready', () => {
    connectionState = 'ready';
  });
  redisClient.on('reconnecting', () => {
    connectionState = 'connecting';
  });
  redisClient.on('error', error => {
    connectionState = 'degraded';
    logger.error('Redis connection error.', error);
  });
  redisClient.on('end', () => {
    connectionState = 'closed';
  });

  try {
    await redisClient.connect();
    await redisClient.ping();
    connectionState = 'ready';
    logger.info('Redis connected and responded to PING.');
  } catch (error) {
    connectionState = 'degraded';
    if (redisClient.isOpen) redisClient.destroy();
    redisClient = null;

    if (required) throw error;
    logger.warn('Redis is unavailable; continuing because REDIS_REQUIRED=false.');
  }

  return getRedisHealth();
}

export function getRedisClient(): RedisClientType {
  if (!redisClient?.isReady) {
    throw new Error('Redis is not ready.');
  }
  return redisClient;
}

export function getRedisHealth(): RedisHealth {
  return {
    configured: Boolean(process.env.REDIS_URL?.trim()),
    required: redisRequired(),
    state: connectionState,
    ready: Boolean(redisClient?.isReady),
  };
}

export function redisKey(key: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX?.trim() || 'dreamscape:';
  return `${prefix}${key.replace(/^:+/u, '')}`;
}

export async function closeRedis(): Promise<void> {
  if (!redisClient) return;

  const client = redisClient;
  redisClient = null;
  if (client.isOpen) await client.close();
  connectionState = 'closed';
  logger.info('Redis connection closed.');
}

function redisRequired(): boolean {
  return process.env.REDIS_REQUIRED?.trim().toLowerCase() === 'true';
}
