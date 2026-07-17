import { DoclingArtifactDescriptor } from './doclingAdapter.service';

export interface PreviewSession {
  moderatorId: string;
  contributionId: string;
  token: string;
  artifacts: { previewFigureId: string; filePath: string; format: string }[];
  cleanup: () => Promise<void>;
  expiresAt: number;
}

export class DoclingPreviewSessionService {
  private static sessions = new Map<string, PreviewSession>();
  private static globalLimit = 50;
  private static perModeratorLimit = 3;
  private static sweepTimer: NodeJS.Timeout | null = null;

  static {
    // Start unref'd sweep timer to prevent preventing process exit
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, 2 * 60 * 1000);
    this.sweepTimer.unref();
  }

  private static sweepExpired() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
        session.cleanup().catch(() => {});
      }
    }
  }

  public static getSession(
    token: string,
    moderatorId: string,
    contributionId: string
  ): PreviewSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      session.cleanup().catch(() => {});
      return null;
    }
    if (session.moderatorId !== moderatorId || session.contributionId !== contributionId) {
      return null;
    }
    return session;
  }

  public static async createSession(
    moderatorId: string,
    contributionId: string,
    token: string,
    artifacts: { previewFigureId: string; filePath: string; format: string }[],
    cleanup: () => Promise<void>
  ): Promise<void> {
    // 1. Evict any existing session for the same moderator + contribution
    for (const [t, s] of this.sessions.entries()) {
      if (s.moderatorId === moderatorId && s.contributionId === contributionId) {
        this.sessions.delete(t);
        await s.cleanup().catch(() => {});
      }
    }

    // 2. Check per-moderator limit
    const modSessions = Array.from(this.sessions.entries())
      .filter(([_, s]) => s.moderatorId === moderatorId)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt); // oldest first

    if (modSessions.length >= this.perModeratorLimit) {
      const [tEvict, sEvict] = modSessions[0];
      this.sessions.delete(tEvict);
      await sEvict.cleanup().catch(() => {});
    }

    // 3. Check global limit
    if (this.sessions.size >= this.globalLimit) {
      const oldest = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) {
        this.sessions.delete(oldest[0]);
        await oldest[1].cleanup().catch(() => {});
      }
    }

    // 4. Store new session (TTL 15 minutes)
    this.sessions.set(token, {
      moderatorId,
      contributionId,
      token,
      artifacts,
      cleanup,
      expiresAt: Date.now() + 15 * 60 * 1000
    });
  }

  public static async closeSession(token: string, moderatorId: string, contributionId: string): Promise<boolean> {
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.moderatorId !== moderatorId || session.contributionId !== contributionId) {
      return false;
    }
    this.sessions.delete(token);
    await session.cleanup().catch(() => {});
    return true;
  }
}
