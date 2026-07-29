import { IUser } from '../../models/User';

export class SessionLifecycleError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SessionLifecycleError';
  }
}

export function presentUserSessions(
  user: IUser,
  currentSessionId?: string,
) {
  return user.sessions.map((session) => ({
    _id: session._id,
    device_name: session.deviceOS || 'Unknown OS',
    browser: session.deviceBrowser || 'Unknown Browser',
    location: session.ipAddress || 'Unknown IP',
    last_active: session.lastActive,
    authenticated_at: session.authenticatedAt || null,
    is_current: String(session._id) === String(currentSessionId),
  }));
}

export async function removeCurrentSession(
  user: IUser,
  currentSessionId?: string,
): Promise<void> {
  if (!currentSessionId) return;

  user.sessions = user.sessions.filter(
    (session) => String(session._id) !== String(currentSessionId),
  );
  await user.save();
}

export async function revokeUserSession(
  user: IUser,
  sessionId: string | string[] | undefined,
  currentSessionId?: string,
): Promise<void> {
  if (!sessionId) {
    throw new SessionLifecycleError(400, 'Session ID is required.');
  }
  const normalizedSessionId = String(sessionId);
  if (normalizedSessionId === String(currentSessionId)) {
    throw new SessionLifecycleError(
      400,
      'Cannot revoke the current active session. Use the logout endpoint instead.',
    );
  }

  user.sessions = user.sessions.filter(
    (session) => String(session._id) !== normalizedSessionId,
  );
  await user.save();
}
