import { Server as SocketIOServer } from 'socket.io';
import User from '../../../identity/models/User';
import { logger } from '../../../../infrastructure/logger';

export interface UserPresencePayload {
  userId: string;
  isOnline: boolean;
  lastActiveAt: string;
}

export async function publishUserOnline(
  io: SocketIOServer,
  userId: string,
): Promise<void> {
  await publishPresence(io, userId, true);
}

export async function publishUserOfflineWhenLastSocketCloses(
  io: SocketIOServer,
  userId: string,
): Promise<void> {
  const remainingSockets = await io.in(userId).fetchSockets();
  if (remainingSockets.length > 0) return;
  await publishPresence(io, userId, false);
}

async function publishPresence(
  io: SocketIOServer,
  userId: string,
  isOnline: boolean,
): Promise<void> {
  const lastActiveAt = new Date();
  await User.findByIdAndUpdate(userId, { $set: { lastHeartbeatAt: lastActiveAt } });

  const payload: UserPresencePayload = {
    userId,
    isOnline,
    lastActiveAt: lastActiveAt.toISOString(),
  };
  io.emit('user_presence_changed', payload);
  logger.info('User presence changed.', { userId, isOnline });
}
