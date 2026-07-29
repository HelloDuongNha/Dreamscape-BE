import { Request } from 'express';

export function readIdentityClientContext(req: Request) {
  return {
    userAgent: req.headers['user-agent'] || '',
    ipAddress:
      (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '',
  };
}

export function readIdentityNetworkOrigin(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || 'unknown';
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}
