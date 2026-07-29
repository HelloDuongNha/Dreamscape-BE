import User, { type IUser } from '../../models/User';
import jwt from 'jsonwebtoken';
import {
  assertPasswordConfirmation,
  assertPasswordPolicy,
  PasswordPolicyError,
} from './passwordPolicy.service';
import {
  hasRecentAuthentication,
  markSessionRecentlyAuthenticated,
  revokeOtherSessions,
} from './sessionSecurity.service';
import { consumeRecoveryGrant, restoreRecoveryGrant } from '../otp/otpLifecycle.service';

export class AccountSecurityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AccountSecurityError';
  }
}

export async function changePasswordWithCurrent(input: {
  userId: string;
  sessionId?: string | null;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  assertPasswordPolicy(input.newPassword);
  assertPasswordConfirmation(input.newPassword, input.confirmPassword);
  const user = await loadPasswordUser(input.userId);
  assertPasswordAccount(user);
  if (!(await user.comparePassword(input.currentPassword))) {
    throw new AccountSecurityError('current_password_invalid', 401, 'Current password is incorrect.');
  }
  if (await user.comparePassword(input.newPassword)) {
    throw new AccountSecurityError(
      'password_reused',
      409,
      'New password must be different from the current password.',
    );
  }

  user.password = input.newPassword;
  markSessionRecentlyAuthenticated(user, input.sessionId);
  await user.save();
}

export async function resetPasswordWithGrant(input: {
  email: string;
  recoveryGrant: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<string> {
  assertPasswordPolicy(input.newPassword);
  assertPasswordConfirmation(input.newPassword, input.confirmPassword);
  const user = await User.findOne({ email: input.email.trim().toLowerCase() }).select('+password');
  if (!user) {
    throw new AccountSecurityError('recovery_grant_invalid', 400, 'Invalid or expired recovery grant.');
  }
  assertPasswordAccount(user);
  if (await user.comparePassword(input.newPassword)) {
    throw new AccountSecurityError(
      'password_reused',
      409,
      'New password must be different from the current password.',
    );
  }

  const grantRecordId = await consumeRecoveryGrant(input.email, input.recoveryGrant);
  try {
    user.password = input.newPassword;
    await user.save();
  } catch (error) {
    // A consumed grant is restored only when persistence fails, so a transient DB
    // error cannot lock the account owner out of the recovery flow.
    await restoreRecoveryGrant(grantRecordId);
    throw error;
  }
  return String(user._id);
}

export async function assertEmailChangeAuthorization(input: {
  user: IUser;
  sessionId?: string | null;
  currentPassword?: string;
}): Promise<void> {
  if (hasRecentAuthentication(input.user, input.sessionId)) return;
  if (!input.currentPassword) {
    throw new AccountSecurityError(
      'recent_auth_required',
      401,
      'Enter your current password to change the account email.',
    );
  }
  const user = await loadPasswordUser(String(input.user._id));
  assertPasswordAccount(user);
  if (!(await user.comparePassword(input.currentPassword))) {
    throw new AccountSecurityError('current_password_invalid', 401, 'Current password is incorrect.');
  }
  markSessionRecentlyAuthenticated(input.user, input.sessionId);
  await input.user.save();
}

export async function revokeAllOtherSessions(user: IUser, sessionId?: string | null): Promise<number> {
  if (!sessionId) {
    throw new AccountSecurityError('active_session_required', 401, 'An active session is required.');
  }
  const revokedCount = revokeOtherSessions(user, sessionId);
  await user.save();
  return revokedCount;
}

export function createRecoverySessionRevocationGrant(userId: string): string {
  return jwt.sign(
    { sub: userId, purpose: 'revoke_sessions_after_recovery' },
    sessionGrantSecret(),
    { expiresIn: '5m' },
  );
}

export async function revokeSessionsWithRecoveryGrant(grant: string): Promise<number> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(grant, sessionGrantSecret()) as jwt.JwtPayload;
  } catch {
    throw new AccountSecurityError(
      'session_revocation_grant_invalid',
      400,
      'The session revocation choice has expired.',
    );
  }
  if (payload.purpose !== 'revoke_sessions_after_recovery' || !payload.sub) {
    throw new AccountSecurityError(
      'session_revocation_grant_invalid',
      400,
      'The session revocation choice is invalid.',
    );
  }
  const user = await User.findById(payload.sub);
  if (!user) throw new AccountSecurityError('user_not_found', 404, 'User not found.');
  const revokedCount = user.sessions.length;
  user.sessions = [];
  await user.save();
  return revokedCount;
}

async function loadPasswordUser(userId: string) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AccountSecurityError('user_not_found', 404, 'User not found.');
  return user;
}

function assertPasswordAccount(user: IUser): void {
  if (user.authMethod === 'google') {
    throw new AccountSecurityError(
      'password_provider_conflict',
      409,
      'This account uses Google sign-in and does not have a password to change.',
    );
  }
}

function sessionGrantSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new AccountSecurityError(
      'session_revocation_unavailable',
      503,
      'Session revocation is temporarily unavailable.',
    );
  }
  return secret;
}

export { PasswordPolicyError };
