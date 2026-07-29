import type { HydratedDocument } from 'mongoose';
import Otp, { type IOtp, type OtpPurpose } from '../../models/Otp';
import { sendOtpEmail } from '../../../../infrastructure/emailService';
import {
  currentOtpCodeVersion,
  generateOtpCode,
  generateRecoveryGrant,
  hashOtpCode,
  hashOtpRequestOrigin,
  hashRecoveryGrant,
  type OtpBinding,
  verifyOtpCode,
  verifyRecoveryGrant,
} from './otpCrypto.service';

const OTP_LIFETIME_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const RECOVERY_GRANT_LIFETIME_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_SENDS_PER_FLOW = 5;
const MAX_ISSUES_PER_ORIGIN_WINDOW = 10;
const MAX_ISSUES_PER_EMAIL_WINDOW = 5;
type OtpDelivery = typeof sendOtpEmail;

interface IssueOtpInput extends OtpBinding {
  payload?: Record<string, unknown> | null;
  requestOrigin?: string | null;
}

interface VerifyOtpInput extends OtpBinding {
  code: string;
}

export interface VerifiedOtp {
  record: HydratedDocument<IOtp>;
  recoveryGrant?: string;
}

export class OtpFlowError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: { retryAfterSeconds?: number; attemptsRemaining?: number },
  ) {
    super(message);
    this.name = 'OtpFlowError';
  }
}

export async function issueOtp(
  input: IssueOtpInput,
  deliver: OtpDelivery = sendOtpEmail,
): Promise<{
  expiresAt: Date;
  resendAvailableAt: Date;
}> {
  const binding = normalizeBinding(input);
  const now = new Date();
  const code = generateOtpCode();
  const identity = otpIdentityQuery(binding);
  const requestFingerprint = input.requestOrigin
    ? hashOtpRequestOrigin(input.requestOrigin)
    : null;

  await enforceIssueRateLimit(binding, requestFingerprint, now);
  await Otp.updateMany(
    { ...identity, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  const record = await Otp.create({
    ...identity,
    codeHash: hashOtpCode(code, binding),
    codeVersion: currentOtpCodeVersion(),
    requestFingerprint,
    payload: input.payload || null,
    attemptCount: 0,
    maxAttempts: MAX_OTP_ATTEMPTS,
    resendAvailableAt: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
    sendCount: 1,
    expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
  });

  try {
    await deliver(binding.email, code, binding.purpose);
  } catch (error) {
    await Otp.deleteOne({ _id: record._id });
    throw error;
  }

  return {
    expiresAt: record.expiresAt,
    resendAvailableAt: record.resendAvailableAt,
  };
}

async function enforceIssueRateLimit(
  binding: OtpBinding,
  requestFingerprint: string | null,
  now: Date,
): Promise<void> {
  const windowStart = new Date(now.getTime() - OTP_LIFETIME_MS);
  const [emailIssueCount, originIssueCount] = await Promise.all([
    Otp.countDocuments({
      email: binding.email,
      purpose: binding.purpose,
      createdAt: { $gt: windowStart },
    }),
    requestFingerprint
      ? Otp.countDocuments({
          requestFingerprint,
          createdAt: { $gt: windowStart },
        })
      : Promise.resolve(0),
  ]);

  if (
    emailIssueCount >= MAX_ISSUES_PER_EMAIL_WINDOW ||
    originIssueCount >= MAX_ISSUES_PER_ORIGIN_WINDOW
  ) {
    throw new OtpFlowError(
      'otp_issue_limit',
      429,
      'Too many verification codes were requested. Please try again later.',
      { retryAfterSeconds: Math.ceil(OTP_LIFETIME_MS / 1000) },
    );
  }
}

export async function verifyAndConsumeOtp(input: VerifyOtpInput): Promise<VerifiedOtp> {
  const binding = normalizeBinding(input);
  const record = await findActiveOtp(binding, true);
  assertOtpCanBeTried(record);

  if (!verifyOtpCode(input.code, record.codeHash, binding)) {
    const attempted = await Otp.findOneAndUpdate(
      {
        _id: record._id,
        consumedAt: null,
        attemptCount: { $lt: record.maxAttempts },
      },
      { $inc: { attemptCount: 1 } },
      { returnDocument: 'after' },
    );
    const attemptsRemaining = Math.max(
      0,
      record.maxAttempts - (attempted?.attemptCount ?? record.maxAttempts),
    );
    throw new OtpFlowError(
      attemptsRemaining === 0 ? 'otp_locked' : 'otp_invalid',
      400,
      attemptsRemaining === 0
        ? 'Too many incorrect verification attempts.'
        : 'Invalid verification code.',
      { attemptsRemaining },
    );
  }

  const now = new Date();
  const recoveryGrant =
    binding.purpose === 'forgot_password' ? generateRecoveryGrant() : undefined;
  const update: Record<string, unknown> = {
    verifiedAt: now,
    consumedAt: now,
  };
  if (recoveryGrant) {
    update.resetGrantHash = hashRecoveryGrant(recoveryGrant, String(record._id));
    update.resetGrantExpiresAt = new Date(now.getTime() + RECOVERY_GRANT_LIFETIME_MS);
  }

  const consumed = await Otp.findOneAndUpdate(
    {
      _id: record._id,
      consumedAt: null,
      attemptCount: { $lt: record.maxAttempts },
    },
    { $set: update },
    { returnDocument: 'after' },
  ).select('+codeHash +resetGrantHash');
  if (!consumed) {
    const latest = await Otp.findById(record._id);
    if (latest && latest.attemptCount >= latest.maxAttempts) {
      throw new OtpFlowError('otp_locked', 400, 'Too many incorrect verification attempts.', {
        attemptsRemaining: 0,
      });
    }
    throw new OtpFlowError('otp_consumed', 409, 'This verification code has already been used.');
  }

  return { record: consumed, recoveryGrant };
}

export async function resendOtpCode(
  bindingInput: OtpBinding,
  deliver: OtpDelivery = sendOtpEmail,
): Promise<{
  expiresAt: Date;
  resendAvailableAt: Date;
}> {
  const binding = normalizeBinding(bindingInput);
  const record = await findActiveOtp(binding, true);
  const now = new Date();
  if (record.resendAvailableAt.getTime() > now.getTime()) {
    const retryAfterSeconds = Math.ceil(
      (record.resendAvailableAt.getTime() - now.getTime()) / 1000,
    );
    throw new OtpFlowError('otp_resend_cooldown', 429, 'Please wait before requesting a new code.', {
      retryAfterSeconds,
    });
  }
  if (record.sendCount >= MAX_SENDS_PER_FLOW) {
    throw new OtpFlowError(
      'otp_resend_limit',
      429,
      'Too many verification codes were requested. Please restart the flow later.',
    );
  }

  const code = generateOtpCode();
  const previous = {
    codeHash: record.codeHash,
    codeVersion: record.codeVersion,
    attemptCount: record.attemptCount,
    resendAvailableAt: record.resendAvailableAt,
    expiresAt: record.expiresAt,
    sendCount: record.sendCount,
  };
  record.codeHash = hashOtpCode(code, binding);
  record.codeVersion = currentOtpCodeVersion();
  record.attemptCount = 0;
  record.resendAvailableAt = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);
  record.expiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);
  record.sendCount += 1;
  await record.save();

  try {
    await deliver(binding.email, code, binding.purpose);
  } catch (error) {
    await Otp.updateOne({ _id: record._id, codeHash: record.codeHash }, { $set: previous });
    throw error;
  }

  return {
    expiresAt: record.expiresAt,
    resendAvailableAt: record.resendAvailableAt,
  };
}

export async function consumeRecoveryGrant(email: string, grant: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();
  const record = await Otp.findOne({
    email: normalizedEmail,
    purpose: 'forgot_password',
    verifiedAt: { $ne: null },
    resetGrantConsumedAt: null,
    resetGrantExpiresAt: { $gt: now },
  })
    .sort({ createdAt: -1 })
    .select('+resetGrantHash');

  if (
    !record?.resetGrantHash ||
    !verifyRecoveryGrant(grant, record.resetGrantHash, String(record._id))
  ) {
    throw new OtpFlowError('recovery_grant_invalid', 400, 'Invalid or expired recovery grant.');
  }

  const consumed = await Otp.updateOne(
    { _id: record._id, resetGrantConsumedAt: null },
    { $set: { resetGrantConsumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) {
    throw new OtpFlowError('recovery_grant_consumed', 409, 'This recovery grant has already been used.');
  }
  return String(record._id);
}

export async function restoreRecoveryGrant(recordId: string): Promise<void> {
  await Otp.updateOne(
    { _id: recordId, resetGrantConsumedAt: { $ne: null } },
    { $set: { resetGrantConsumedAt: null } },
  );
}

function normalizeBinding(binding: OtpBinding): OtpBinding {
  return {
    email: binding.email.trim().toLowerCase(),
    purpose: binding.purpose,
    subjectUserId: binding.subjectUserId ? String(binding.subjectUserId) : null,
    sessionId: binding.sessionId ? String(binding.sessionId) : null,
  };
}

function otpIdentityQuery(binding: OtpBinding): Record<string, unknown> {
  return {
    email: binding.email,
    purpose: binding.purpose,
    subjectUserId: binding.subjectUserId || null,
    sessionId: binding.sessionId || null,
  };
}

async function findActiveOtp(
  binding: OtpBinding,
  includeHashes: boolean,
): Promise<HydratedDocument<IOtp>> {
  let query = Otp.findOne({
    ...otpIdentityQuery(binding),
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  if (includeHashes) query = query.select('+codeHash +resetGrantHash');
  const record = await query;
  if (!record) {
    throw new OtpFlowError('otp_invalid_or_expired', 400, 'Invalid or expired verification code.');
  }
  return record;
}

function assertOtpCanBeTried(record: HydratedDocument<IOtp>): void {
  if (record.attemptCount >= record.maxAttempts) {
    throw new OtpFlowError('otp_locked', 400, 'Too many incorrect verification attempts.', {
      attemptsRemaining: 0,
    });
  }
}
