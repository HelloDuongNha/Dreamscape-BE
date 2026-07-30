import type { CorsOptions } from 'cors';
import type { Application } from 'express';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredOrigins(): string[] {
  return (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

// Build an exact-origin CORS policy while still allowing non-browser clients.
export function buildCorsOptions(): CorsOptions {
  const allowedOrigins = new Set(configuredOrigins());
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  };
}

// Trust proxy headers only when deployment explicitly declares its proxy depth.
export function configureTrustedProxy(app: Application): void {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return;
  if (/^\d+$/u.test(raw)) {
    app.set('trust proxy', Number.parseInt(raw, 10));
    return;
  }
  if (['loopback', 'linklocal', 'uniquelocal'].includes(raw)) {
    app.set('trust proxy', raw);
  }
}

export const requestLimits = {
  json: process.env.JSON_BODY_LIMIT?.trim() || '1mb',
  urlEncoded: process.env.URLENCODED_BODY_LIMIT?.trim() || '256kb',
} as const;

export const rateLimitPolicies = {
  global: {
    scope: 'global',
    limit: positiveInteger(process.env.RATE_LIMIT_GLOBAL_MAX, 600),
    windowMs: positiveInteger(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS, 5 * 60_000),
  },
  login: {
    scope: 'auth-login',
    limit: positiveInteger(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    windowMs: positiveInteger(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60_000),
  },
  register: {
    scope: 'auth-register',
    limit: positiveInteger(process.env.RATE_LIMIT_REGISTER_MAX, 5),
    windowMs: positiveInteger(process.env.RATE_LIMIT_REGISTER_WINDOW_MS, 60 * 60_000),
  },
  otp: {
    scope: 'auth-otp',
    limit: positiveInteger(process.env.RATE_LIMIT_OTP_MAX, 15),
    windowMs: positiveInteger(process.env.RATE_LIMIT_OTP_WINDOW_MS, 15 * 60_000),
  },
  recovery: {
    scope: 'auth-recovery',
    limit: positiveInteger(process.env.RATE_LIMIT_RECOVERY_MAX, 10),
    windowMs: positiveInteger(process.env.RATE_LIMIT_RECOVERY_WINDOW_MS, 30 * 60_000),
  },
  ai: {
    scope: 'ai-generation',
    limit: positiveInteger(process.env.RATE_LIMIT_AI_MAX, 20),
    windowMs: positiveInteger(process.env.RATE_LIMIT_AI_WINDOW_MS, 30 * 60_000),
  },
  oracle: {
    scope: 'oracle-generation',
    limit: positiveInteger(process.env.RATE_LIMIT_ORACLE_MAX, 60),
    windowMs: positiveInteger(process.env.RATE_LIMIT_ORACLE_WINDOW_MS, 30 * 60_000),
  },
  upload: {
    scope: 'document-upload',
    limit: positiveInteger(process.env.RATE_LIMIT_UPLOAD_MAX, 20),
    windowMs: positiveInteger(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 60 * 60_000),
  },
} as const;

export function apiDocsEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ENABLE_API_DOCS?.trim().toLowerCase() === 'true';
}
