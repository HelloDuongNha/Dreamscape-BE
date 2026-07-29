import crypto from 'node:crypto';
import type { OtpPurpose } from '../../models/Otp';

const OTP_CODE_VERSION = 1;

export interface OtpBinding {
  email: string;
  purpose: OtpPurpose;
  subjectUserId?: string | null;
  sessionId?: string | null;
}

export function generateOtpCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

export function hashOtpCode(code: string, binding: OtpBinding): string {
  return keyedDigest(
    `otp:v${OTP_CODE_VERSION}:${bindingText(binding)}:${code.trim()}`,
  );
}

export function verifyOtpCode(code: string, expectedHash: string, binding: OtpBinding): boolean {
  return constantTimeEqual(hashOtpCode(code, binding), expectedHash);
}

export function generateRecoveryGrant(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRecoveryGrant(grant: string, otpId: string): string {
  return keyedDigest(`recovery-grant:v1:${otpId}:${grant}`);
}

export function verifyRecoveryGrant(
  grant: string,
  expectedHash: string,
  otpId: string,
): boolean {
  return constantTimeEqual(hashRecoveryGrant(grant, otpId), expectedHash);
}

export function currentOtpCodeVersion(): number {
  return OTP_CODE_VERSION;
}

export function hashOtpRequestOrigin(origin: string): string {
  return keyedDigest(`otp-origin:v1:${origin.trim().toLowerCase()}`);
}

function bindingText(binding: OtpBinding): string {
  return [
    binding.purpose,
    binding.email.trim().toLowerCase(),
    binding.subjectUserId || '',
    binding.sessionId || '',
  ].join(':');
}

function keyedDigest(value: string): string {
  return crypto.createHmac('sha256', otpHmacSecret()).update(value, 'utf8').digest('base64url');
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function otpHmacSecret(): string {
  const dedicatedSecret = process.env.OTP_HMAC_SECRET?.trim();
  if (dedicatedSecret && dedicatedSecret.length >= 32) return dedicatedSecret;

  const developmentFallback =
    process.env.NODE_ENV !== 'production' ? process.env.JWT_SECRET?.trim() : undefined;
  if (developmentFallback && developmentFallback.length >= 24) return developmentFallback;

  throw new Error('OTP_HMAC_SECRET must contain at least 32 characters.');
}
