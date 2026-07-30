import { Request } from 'express';

export function readIdentityClientContext(req: Request) {
  return {
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip || req.socket.remoteAddress || '',
  };
}

export function readIdentityNetworkOrigin(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
