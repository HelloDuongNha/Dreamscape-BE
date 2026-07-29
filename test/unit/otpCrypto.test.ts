import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRecoveryGrant,
  hashOtpCode,
  hashRecoveryGrant,
  verifyOtpCode,
  verifyRecoveryGrant,
} from '../../src/modules/identity/services/otp/otpCrypto.service';

const TEST_SECRET = 'test-only-otp-secret-with-at-least-32-characters';

test('OTP hashes are purpose, email, user, and session bound', () => {
  withOtpSecret(() => {
    const binding = {
      email: 'user@example.test',
      purpose: 'update_email' as const,
      subjectUserId: 'user-1',
      sessionId: 'session-1',
    };
    const hash = hashOtpCode('123456', binding);

    assert.equal(verifyOtpCode('123456', hash, binding), true);
    assert.equal(verifyOtpCode('654321', hash, binding), false);
    assert.equal(verifyOtpCode('123456', hash, { ...binding, purpose: 'register' }), false);
    assert.equal(verifyOtpCode('123456', hash, { ...binding, email: 'other@example.test' }), false);
    assert.equal(verifyOtpCode('123456', hash, { ...binding, subjectUserId: 'user-2' }), false);
    assert.equal(verifyOtpCode('123456', hash, { ...binding, sessionId: 'session-2' }), false);
  });
});

test('recovery grants are random, record-bound, and constant-time verified', () => {
  withOtpSecret(() => {
    const firstGrant = generateRecoveryGrant();
    const secondGrant = generateRecoveryGrant();
    assert.notEqual(firstGrant, secondGrant);

    const hash = hashRecoveryGrant(firstGrant, 'otp-record-1');
    assert.equal(verifyRecoveryGrant(firstGrant, hash, 'otp-record-1'), true);
    assert.equal(verifyRecoveryGrant(secondGrant, hash, 'otp-record-1'), false);
    assert.equal(verifyRecoveryGrant(firstGrant, hash, 'otp-record-2'), false);
  });
});

test('production OTP hashing fails closed without a dedicated secret', () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalOtpSecret = process.env.OTP_HMAC_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_HMAC_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;
    assert.throws(
      () =>
        hashOtpCode('123456', {
          email: 'user@example.test',
          purpose: 'register',
        }),
      /OTP_HMAC_SECRET/,
    );
  } finally {
    restoreEnvironmentValue('NODE_ENV', originalEnvironment);
    restoreEnvironmentValue('OTP_HMAC_SECRET', originalOtpSecret);
    restoreEnvironmentValue('JWT_SECRET', originalJwtSecret);
  }
});

function withOtpSecret(run: () => void): void {
  const original = process.env.OTP_HMAC_SECRET;
  try {
    process.env.OTP_HMAC_SECRET = TEST_SECRET;
    run();
  } finally {
    restoreEnvironmentValue('OTP_HMAC_SECRET', original);
  }
}

function restoreEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
