import type { IUser } from '../../models/User';

const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

export function findCurrentSession(user: IUser, sessionId?: string | null) {
  if (!sessionId) return null;
  return user.sessions.find((session) => String(session._id) === String(sessionId)) || null;
}

export function hasRecentAuthentication(user: IUser, sessionId?: string | null): boolean {
  const authenticatedAt = findCurrentSession(user, sessionId)?.authenticatedAt;
  return Boolean(
    authenticatedAt &&
      Date.now() - authenticatedAt.getTime() <= RECENT_AUTH_WINDOW_MS,
  );
}

export function markSessionRecentlyAuthenticated(user: IUser, sessionId?: string | null): void {
  const session = findCurrentSession(user, sessionId);
  if (session) session.authenticatedAt = new Date();
}

export function revokeOtherSessions(user: IUser, currentSessionId?: string | null): number {
  const before = user.sessions.length;
  user.sessions = currentSessionId
    ? user.sessions.filter((session) => String(session._id) === String(currentSessionId))
    : [];
  return before - user.sessions.length;
}
