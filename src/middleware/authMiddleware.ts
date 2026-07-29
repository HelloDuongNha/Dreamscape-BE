import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User, { IUser } from '../modules/identity/models/User';
import { recordStreakAsync } from './streakMiddleware';
import { requireEnvironmentSecret } from '../config/env';

// ─── Augment Express Request ──────────────────────────────────────────────────
// Attach the authenticated user to the request so downstream handlers can
// access it without re-querying the DB every time.

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      sessionId?: string;
    }
  }
}

// ─── JWT Payload Shape ────────────────────────────────────────────────────────

interface JwtPayload {
  id: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Protects private routes by verifying the JWT passed in the
 * `Authorization: Bearer <token>` header.
 *
 * On success  → attaches `req.user` and calls `next()`.
 * On failure  → responds with 401 Unauthorized.
 */
const authMiddleware = createAuthenticationMiddleware(true);
export const optionalAuthMiddleware = createAuthenticationMiddleware(false);

function createAuthenticationMiddleware(required: boolean) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (!required && !authHeader) {
      next();
      return;
    }
    res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  let secret: string;
  try {
    secret = requireEnvironmentSecret('JWT_SECRET');
  } catch {
    res.status(500).json({
      success: false,
      message: 'Server configuration error: JWT_SECRET is not set.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    if (!decoded.sessionId) {
      res.status(401).json({
        success: false,
        code: 'session_upgrade_required',
        message: 'Please sign in again to establish a revocable session.',
      });
      return;
    }

    // Fetch the user from DB to ensure the account still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.',
      });
      return;
    }

    // Verify session is active (not revoked)
    if (user.sessions) {
      const sessionExists = user.sessions.some(
        (s) => String(s._id) === String(decoded.sessionId)
      );
      if (!sessionExists) {
        res.status(401).json({
          success: false,
          message: 'Session has been revoked or expired.',
        });
        return;
      }
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    // Fire-and-forget streak tracker — never blocks the response
    recordStreakAsync(user);
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
  };
}

/**
 * Protects administration routes using the persisted account role.
 *
 * The role is loaded from MongoDB on every authenticated request, so changing
 * an email address or issuing a new JWT cannot grant or remove privileges.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  if (req.user.role === 'admin') {
    next();
    return;
  }

  res.status(403).json({ success: false, message: 'Forbidden. Administrator privileges required.' });
};

export default authMiddleware;
