import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Socket } from 'socket.io';
import User from '../../../identity/models/User';
import { requireEnvironmentSecret } from '../../../../config/env';

export interface AuthenticatedMessagingSocket extends Socket {
  userId: string;
}

export async function authenticateMessagingSocket(
  socket: Socket,
  next: (error?: Error) => void,
): Promise<void> {
  const token = readHandshakeToken(socket);
  if (!token) {
    next(new Error('Unauthorized: no token provided'));
    return;
  }

  let secret: string;
  try {
    secret = requireEnvironmentSecret('JWT_SECRET');
  } catch {
    next(new Error('Server misconfiguration: JWT_SECRET missing'));
    return;
  }

  try {
    const identity = jwt.verify(token, secret) as {
      id: string;
      sessionId?: string;
    };
    if (!identity.sessionId || !Types.ObjectId.isValid(identity.sessionId)) {
      next(new Error('Unauthorized: session upgrade required'));
      return;
    }

    const sessionExists = await User.exists({
      _id: identity.id,
      'sessions._id': new Types.ObjectId(identity.sessionId),
    });
    if (!sessionExists) {
      next(new Error('Unauthorized: session revoked'));
      return;
    }

    (socket as AuthenticatedMessagingSocket).userId = identity.id;
    next();
  } catch {
    next(new Error('Unauthorized: invalid or expired token'));
  }
}

function readHandshakeToken(socket: Socket): string | undefined {
  const raw =
    socket.handshake.auth?.token ??
    socket.handshake.headers?.authorization;
  return raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
}
