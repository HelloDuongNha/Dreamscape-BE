import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import Otp from '../../src/modules/identity/models/Otp';
import {
  consumeRecoveryGrant,
  issueOtp,
  OtpFlowError,
  resendOtpCode,
  verifyAndConsumeOtp,
} from '../../src/modules/identity/services/otp/otpLifecycle.service';
import {
  currentOtpCodeVersion,
  hashOtpCode,
} from '../../src/modules/identity/services/otp/otpCrypto.service';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
const TEST_SECRET = 'integration-only-otp-secret-with-at-least-32-characters';

before(async () => {
  if (!databaseConfigured) return;
  process.env.OTP_HMAC_SECRET = TEST_SECRET;
  await connectTestDatabase();
  await Otp.deleteMany({});
});

after(async () => {
  if (!databaseConfigured) return;
  await Otp.deleteMany({});
  await disconnectTestDatabase();
});

test(
  'OTP attempts are bounded and the correct code is consumed only once',
  { skip: !databaseConfigured },
  async () => {
    const binding = {
      email: 'bounded@example.test',
      purpose: 'register' as const,
    };
    await createOtpRecord('123456', binding, { maxAttempts: 2 });
    const persisted = await Otp.collection.findOne({ email: binding.email });
    assert.equal('otpCode' in (persisted || {}), false);
    assert.equal(typeof persisted?.codeHash, 'string');

    await assert.rejects(
      verifyAndConsumeOtp({ ...binding, code: '000000' }),
      (error: unknown) =>
        error instanceof OtpFlowError &&
        error.code === 'otp_invalid' &&
        error.details?.attemptsRemaining === 1,
    );
    await assert.rejects(
      verifyAndConsumeOtp({ ...binding, code: '000000' }),
      (error: unknown) => error instanceof OtpFlowError && error.code === 'otp_locked',
    );
    await assert.rejects(
      verifyAndConsumeOtp({ ...binding, code: '123456' }),
      (error: unknown) => error instanceof OtpFlowError && error.code === 'otp_locked',
    );

    await Otp.deleteMany({});
    await createOtpRecord('123456', binding);
    await verifyAndConsumeOtp({ ...binding, code: '123456' });
    await assert.rejects(
      verifyAndConsumeOtp({ ...binding, code: '123456' }),
      (error: unknown) =>
        error instanceof OtpFlowError && error.code === 'otp_invalid_or_expired',
    );
  },
);

test(
  'OTP purpose binding and resend cooldown reject cross-flow or early use',
  { skip: !databaseConfigured },
  async () => {
    const binding = {
      email: 'binding@example.test',
      purpose: 'register' as const,
    };
    await createOtpRecord('123456', binding);

    await assert.rejects(
      verifyAndConsumeOtp({
        email: binding.email,
        purpose: 'forgot_password',
        code: '123456',
      }),
      (error: unknown) =>
        error instanceof OtpFlowError && error.code === 'otp_invalid_or_expired',
    );
    await assert.rejects(
      resendOtpCode(binding),
      (error: unknown) =>
        error instanceof OtpFlowError &&
        error.code === 'otp_resend_cooldown' &&
        Number(error.details?.retryAfterSeconds) > 0,
    );

    await Otp.updateOne(
      { email: binding.email, purpose: binding.purpose },
      { $set: { resendAvailableAt: new Date(Date.now() - 1_000) } },
    );
    let deliveredCode = '';
    await resendOtpCode(binding, async (_email, code) => {
      deliveredCode = code;
    });
    assert.match(deliveredCode, /^\d{6}$/);
    await verifyAndConsumeOtp({ ...binding, code: deliveredCode });
  },
);

test(
  'issuing an OTP persists only its hash before invoking the delivery adapter',
  { skip: !databaseConfigured },
  async () => {
    let deliveredCode = '';
    await issueOtp(
      {
        email: 'issued@example.test',
        purpose: 'register',
        payload: { passwordHash: 'bcrypt-hash-placeholder' },
      },
      async (_email, code) => {
        deliveredCode = code;
      },
    );

    const persisted = await Otp.collection.findOne({ email: 'issued@example.test' });
    assert.match(deliveredCode, /^\d{6}$/);
    assert.equal('otpCode' in (persisted || {}), false);
    assert.equal(typeof persisted?.codeHash, 'string');
    assert.notEqual(persisted?.codeHash, deliveredCode);
  },
);

test(
  'OTP issuance is bounded per email and request origin window',
  { skip: !databaseConfigured },
  async () => {
    const input = {
      email: 'rate-limited@example.test',
      purpose: 'register' as const,
      requestOrigin: '198.51.100.10',
    };
    const delivery = async () => undefined;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await issueOtp(input, delivery);
    }
    await assert.rejects(
      issueOtp(input, delivery),
      (error: unknown) =>
        error instanceof OtpFlowError &&
        error.code === 'otp_issue_limit' &&
        error.status === 429,
    );
  },
);

test(
  'forgot-password verification creates a record-bound one-time recovery grant',
  { skip: !databaseConfigured },
  async () => {
    const binding = {
      email: 'recovery@example.test',
      purpose: 'forgot_password' as const,
    };
    await createOtpRecord('654321', binding);

    const verified = await verifyAndConsumeOtp({ ...binding, code: '654321' });
    assert.ok(verified.recoveryGrant);
    await consumeRecoveryGrant(binding.email, verified.recoveryGrant);
    await assert.rejects(
      consumeRecoveryGrant(binding.email, verified.recoveryGrant),
      (error: unknown) =>
        error instanceof OtpFlowError && error.code === 'recovery_grant_invalid',
    );
  },
);

async function createOtpRecord(
  code: string,
  binding: { email: string; purpose: 'register' | 'forgot_password' },
  overrides: { maxAttempts?: number } = {},
): Promise<void> {
  const now = Date.now();
  await Otp.create({
    ...binding,
    codeHash: hashOtpCode(code, binding),
    codeVersion: currentOtpCodeVersion(),
    attemptCount: 0,
    maxAttempts: overrides.maxAttempts ?? 5,
    resendAvailableAt: new Date(now + 60_000),
    sendCount: 1,
    expiresAt: new Date(now + 300_000),
  });
}
