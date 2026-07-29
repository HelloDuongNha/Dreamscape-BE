import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import User from '../../src/modules/identity/models/User';
import Otp from '../../src/modules/identity/models/Otp';
import {
  AccountSecurityError,
  changePasswordWithCurrent,
  createRecoverySessionRevocationGrant,
  resetPasswordWithGrant,
  revokeAllOtherSessions,
  revokeSessionsWithRecoveryGrant,
} from '../../src/modules/identity/services/security/accountSecurity.service';
import {
  currentOtpCodeVersion,
  generateRecoveryGrant,
  hashOtpCode,
  hashRecoveryGrant,
} from '../../src/modules/identity/services/otp/otpCrypto.service';
import { verifyAndConsumeOtp } from '../../src/modules/identity/services/otp/otpLifecycle.service';
import { startEmailChange } from '../../src/modules/identity/controllers/accountSecurity.controller';
import { verifyEmailChangeOtp } from '../../src/modules/identity/controllers/authController';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);

before(async () => {
  if (!databaseConfigured) return;
  await connectTestDatabase();
});

beforeEach(async () => {
  if (!databaseConfigured) return;
  await User.deleteMany({});
  await Otp.deleteMany({});
});

after(async () => {
  if (!databaseConfigured) return;
  await User.deleteMany({});
  await Otp.deleteMany({});
  await disconnectTestDatabase();
});

test('password change rejects wrong and reused passwords, then persists the valid password', { skip: !databaseConfigured }, async () => {
  const currentSessionId = new mongoose.Types.ObjectId();
  const user = await User.create({
    username: '@security_test',
    display_name: 'Security Test',
    email: 'security@example.test',
    password: 'CurrentPass9',
    sessions: [
      { _id: currentSessionId, authenticatedAt: new Date(), lastActive: new Date() },
      { _id: new mongoose.Types.ObjectId(), authenticatedAt: new Date(), lastActive: new Date() },
    ],
  });

  await assert.rejects(
    changePasswordWithCurrent({
      userId: String(user._id),
      sessionId: String(currentSessionId),
      currentPassword: 'WrongPass9',
      newPassword: 'Replacement9A',
      confirmPassword: 'Replacement9A',
    }),
    (error: unknown) =>
      error instanceof AccountSecurityError && error.code === 'current_password_invalid',
  );
  await assert.rejects(
    changePasswordWithCurrent({
      userId: String(user._id),
      sessionId: String(currentSessionId),
      currentPassword: 'CurrentPass9',
      newPassword: 'CurrentPass9',
      confirmPassword: 'CurrentPass9',
    }),
    (error: unknown) =>
      error instanceof AccountSecurityError && error.code === 'password_reused',
  );

  await changePasswordWithCurrent({
    userId: String(user._id),
    sessionId: String(currentSessionId),
    currentPassword: 'CurrentPass9',
    newPassword: 'Replacement9A',
    confirmPassword: 'Replacement9A',
  });
  const changed = await User.findById(user._id).select('+password');
  assert.equal(await changed!.comparePassword('Replacement9A'), true);
  assert.equal(await changed!.comparePassword('CurrentPass9'), false);
});

test('revoking other sessions preserves the authenticated current session', { skip: !databaseConfigured }, async () => {
  const currentSessionId = new mongoose.Types.ObjectId();
  const user = await User.create({
    username: '@session_test',
    display_name: 'Session Test',
    email: 'sessions@example.test',
    password: 'CurrentPass9',
    sessions: [
      { _id: currentSessionId, lastActive: new Date() },
      { _id: new mongoose.Types.ObjectId(), lastActive: new Date() },
    ],
  });

  assert.equal(await revokeAllOtherSessions(user, String(currentSessionId)), 1);
  const persisted = await User.findById(user._id);
  assert.equal(persisted!.sessions.length, 1);
  assert.equal(String(persisted!.sessions[0]._id), String(currentSessionId));
});

test('verified recovery grant changes password once and can explicitly revoke previous sessions', { skip: !databaseConfigured }, async () => {
  process.env.JWT_SECRET = 'integration-session-grant-secret';
  const user = await User.create({
    username: '@recovery_test',
    display_name: 'Recovery Test',
    email: 'recovery-security@example.test',
    password: 'CurrentPass9',
    sessions: [
      { _id: new mongoose.Types.ObjectId(), lastActive: new Date() },
      { _id: new mongoose.Types.ObjectId(), lastActive: new Date() },
    ],
  });
  const recoveryGrant = generateRecoveryGrant();
  const binding = { email: user.email, purpose: 'forgot_password' as const };
  const record = await Otp.create({
    ...binding,
    codeHash: hashOtpCode('123456', binding),
    codeVersion: currentOtpCodeVersion(),
    attemptCount: 0,
    maxAttempts: 5,
    sendCount: 1,
    resendAvailableAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    verifiedAt: new Date(),
    consumedAt: new Date(),
    resetGrantExpiresAt: new Date(Date.now() + 300_000),
  });
  record.resetGrantHash = hashRecoveryGrant(recoveryGrant, String(record._id));
  await record.save();

  const userId = await resetPasswordWithGrant({
    email: user.email,
    recoveryGrant,
    newPassword: 'RecoveredPass9',
    confirmPassword: 'RecoveredPass9',
  });
  await assert.rejects(
    resetPasswordWithGrant({
      email: user.email,
      recoveryGrant,
      newPassword: 'AnotherPass9',
      confirmPassword: 'AnotherPass9',
    }),
  );
  const revocationGrant = createRecoverySessionRevocationGrant(userId);
  assert.equal(await revokeSessionsWithRecoveryGrant(revocationGrant), 2);
  assert.equal((await User.findById(user._id))!.sessions.length, 0);
});

test('email verification codes are bound to the account and initiating session', { skip: !databaseConfigured }, async () => {
  const binding = {
    email: 'new-email@example.test',
    purpose: 'update_email' as const,
    subjectUserId: new mongoose.Types.ObjectId().toString(),
    sessionId: new mongoose.Types.ObjectId().toString(),
  };
  await Otp.create({
    ...binding,
    codeHash: hashOtpCode('123456', binding),
    codeVersion: currentOtpCodeVersion(),
    attemptCount: 0,
    maxAttempts: 5,
    sendCount: 1,
    resendAvailableAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
  });

  await assert.rejects(
    verifyAndConsumeOtp({ ...binding, sessionId: new mongoose.Types.ObjectId().toString(), code: '123456' }),
  );
  await verifyAndConsumeOtp({ ...binding, code: '123456' });
});

test('Google-only account receives an explicit provider conflict on password change', { skip: !databaseConfigured }, async () => {
  const user = await User.create({
    username: '@google_only_test',
    display_name: 'Google Test',
    email: 'google-only@example.test',
    password: 'CurrentPass9',
    authMethod: 'google',
  });
  await assert.rejects(
    changePasswordWithCurrent({
      userId: String(user._id),
      currentPassword: 'CurrentPass9',
      newPassword: 'Replacement9A',
      confirmPassword: 'Replacement9A',
    }),
    (error: unknown) =>
      error instanceof AccountSecurityError && error.code === 'password_provider_conflict',
  );
});

test('email change rejects invalid/duplicate addresses and commits only a session-bound OTP', { skip: !databaseConfigured }, async () => {
  const sessionId = new mongoose.Types.ObjectId();
  const user = await User.create({
    username: '@email_owner',
    display_name: 'Email Owner',
    email: 'email-owner@example.test',
    password: 'CurrentPass9',
    sessions: [{ _id: sessionId, authenticatedAt: new Date(), lastActive: new Date() }],
  });
  await User.create({
    username: '@email_duplicate',
    display_name: 'Email Duplicate',
    email: 'email-duplicate@example.test',
    password: 'CurrentPass9',
  });

  assert.equal((await invokeController(startEmailChange, {
    body: { email: 'invalid-email' },
    user,
    sessionId: String(sessionId),
  })).status, 400);
  assert.equal((await invokeController(startEmailChange, {
    body: { email: 'email-duplicate@example.test' },
    user,
    sessionId: String(sessionId),
  })).status, 409);

  const binding = {
    email: 'email-new@example.test',
    purpose: 'update_email' as const,
    subjectUserId: String(user._id),
    sessionId: String(sessionId),
  };
  await Otp.create({
    ...binding,
    payload: { email: binding.email },
    codeHash: hashOtpCode('654321', binding),
    codeVersion: currentOtpCodeVersion(),
    attemptCount: 0,
    maxAttempts: 5,
    sendCount: 1,
    resendAvailableAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
  });
  const verified = await invokeController(verifyEmailChangeOtp, {
    body: { email: binding.email, otpCode: '654321' },
    user,
    sessionId: String(sessionId),
  });
  assert.equal(verified.status, 200);
  assert.equal((await User.findById(user._id))!.email, binding.email);
});

async function invokeController(
  controller: (req: any, res: any, next: (error: unknown) => void) => Promise<void>,
  request: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  let status = 200;
  let body: any;
  let forwardedError: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };
  await controller(request, response, (error) => {
    forwardedError = error;
  });
  if (forwardedError) throw forwardedError;
  return { status, body };
}
