import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPasswordConfirmation,
  assertPasswordPolicy,
  PasswordPolicyError,
} from '../../src/modules/identity/services/security/passwordPolicy.service';
import {
  hasRecentAuthentication,
  revokeOtherSessions,
} from '../../src/modules/identity/services/security/sessionSecurity.service';

test('password policy is deterministic across registration, change, and recovery callers', () => {
  assert.doesNotThrow(() => assertPasswordPolicy('StrongPass9'));
  assert.throws(
    () => assertPasswordPolicy('weakpass'),
    (error: unknown) =>
      error instanceof PasswordPolicyError && error.code === 'password_complexity_invalid',
  );
  assert.throws(
    () => assertPasswordConfirmation('StrongPass9', 'StrongPass8'),
    (error: unknown) =>
      error instanceof PasswordPolicyError && error.code === 'password_confirmation_mismatch',
  );
});

test('session revocation retains only the current session', () => {
  const now = new Date();
  const user = {
    sessions: [
      { _id: 'current', authenticatedAt: now },
      { _id: 'other', authenticatedAt: now },
    ],
  } as any;

  assert.equal(hasRecentAuthentication(user, 'current'), true);
  assert.equal(revokeOtherSessions(user, 'current'), 1);
  assert.deepEqual(user.sessions.map((session: any) => session._id), ['current']);
});
