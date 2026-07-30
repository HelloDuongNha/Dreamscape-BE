import mongoose from 'mongoose';
import {
  EmailChangeOtpRequestDto,
  ResendOtpRequestDto,
  VerifyOtpRequestDto,
} from '../../dto/otp.dto';
import { IOtp } from '../../models/Otp';
import User, { IUser } from '../../models/User';
import { AuthenticationClientContext, signIdentityToken } from '../auth/authentication.service';
import { markSessionRecentlyAuthenticated } from '../security/sessionSecurity.service';
import { parseUserAgent } from '../auth/userAgent.service';
import {
  issueOtp,
  resendOtpCode,
  verifyAndConsumeOtp,
} from './otpLifecycle.service';

export class OtpWorkflowError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'OtpWorkflowError';
  }
}

export async function verifyOtpWorkflow(
  input: VerifyOtpRequestDto,
  client: AuthenticationClientContext,
) {
  assertGenericVerificationInput(input);
  if (input.purpose === 'update_email') {
    throw new OtpWorkflowError(
      401,
      'Email change verification requires the authenticated settings flow.',
      'email_change_requires_session',
    );
  }

  const verified = await verifyAndConsumeOtp({
    email: input.email!,
    code: input.otpCode!,
    purpose: input.purpose!,
  });

  if (input.purpose === 'register') {
    return completeRegistrationVerification(verified.record, client);
  }
  if (input.purpose === 'forgot_password') {
    return {
      kind: 'password_recovery' as const,
      recoveryGrant: verified.recoveryGrant,
    };
  }
  throw new OtpWorkflowError(400, 'Unsupported verification purpose.');
}

export async function verifyEmailChangeWorkflow(input: {
  request: EmailChangeOtpRequestDto;
  user: IUser;
  sessionId?: string;
}) {
  const { email, otpCode } = input.request;
  if (!email || !otpCode || !input.sessionId) {
    throw new OtpWorkflowError(
      400,
      'Email, verification code, and an active session are required.',
      'email_change_binding_missing',
    );
  }

  const { record } = await verifyAndConsumeOtp({
    email,
    code: otpCode,
    purpose: 'update_email',
    subjectUserId: String(input.user._id),
    sessionId: input.sessionId,
  });
  const pendingEmail = String(record.payload?.email || '').trim().toLowerCase();
  if (!pendingEmail || pendingEmail !== email.trim().toLowerCase()) {
    throw new OtpWorkflowError(
      400,
      'Pending email change data is invalid.',
      'email_change_binding_invalid',
    );
  }

  const duplicate = await User.exists({
    email: pendingEmail,
    _id: { $ne: input.user._id },
  });
  if (duplicate) {
    throw new OtpWorkflowError(
      409,
      'Email address is already taken.',
      'email_already_used',
    );
  }

  input.user.email = pendingEmail;
  markSessionRecentlyAuthenticated(input.user, input.sessionId);
  await input.user.save();
  await record.deleteOne();
  return input.user;
}

export async function resendEmailChangeWorkflow(input: {
  request: EmailChangeOtpRequestDto;
  userId: string;
  sessionId?: string;
}) {
  if (!input.request.email || !input.sessionId) {
    throw new OtpWorkflowError(
      400,
      'Email and an active session are required.',
      'email_change_binding_missing',
    );
  }
  return resendOtpCode({
    email: input.request.email,
    purpose: 'update_email',
    subjectUserId: input.userId,
    sessionId: input.sessionId,
  });
}

export async function beginPasswordRecovery(
  email: string | undefined,
  requestOrigin: string,
) {
  if (!email) {
    throw new OtpWorkflowError(400, 'Email is required.');
  }

  const normalizedEmail = email.toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return null;

  return issueOtp({
    email: normalizedEmail,
    purpose: 'forgot_password',
    requestOrigin,
  });
}

export async function resendGenericOtp(input: ResendOtpRequestDto) {
  if (!input.email || !input.purpose) {
    throw new OtpWorkflowError(400, 'Email and purpose are required.');
  }
  if (input.purpose === 'update_email') {
    throw new OtpWorkflowError(
      401,
      'Email change resend requires the authenticated settings flow.',
      'email_change_requires_session',
    );
  }
  return resendOtpCode({
    email: input.email,
    purpose: input.purpose,
  });
}

async function completeRegistrationVerification(
  record: mongoose.HydratedDocument<IOtp>,
  client: AuthenticationClientContext,
) {
  const profile = readPendingRegistration(record);
  await assertPendingRegistrationAvailable(profile.email, profile.username);

  const { passwordHash, ...userProfile } = profile;
  const user = new User({ ...userProfile, password: passwordHash });
  user.$locals.passwordAlreadyHashed = true;
  await user.save();

  const sessionId = createInitialSession(user, client);
  await user.save();
  await record.deleteOne();

  return {
    kind: 'registration' as const,
    token: signIdentityToken(String(user._id), String(sessionId)),
    user,
  };
}

function assertGenericVerificationInput(input: VerifyOtpRequestDto): void {
  if (!input.email || !input.otpCode || !input.purpose) {
    throw new OtpWorkflowError(400, 'Email, OTP code, and purpose are required.');
  }
}

function readPendingRegistration(record: mongoose.HydratedDocument<IOtp>) {
  if (!record.payload) {
    throw new OtpWorkflowError(400, 'Pending registration data not found.');
  }

  const payload = record.payload as {
    passwordHash?: string;
    username?: string;
    display_name?: string;
    email?: string;
    avatar?: string;
    bio?: string;
  };
  if (!payload.passwordHash || !payload.username || !payload.display_name || !payload.email) {
    throw new OtpWorkflowError(400, 'Pending registration data is incomplete.');
  }
  return {
    passwordHash: payload.passwordHash,
    username: payload.username,
    display_name: payload.display_name,
    email: payload.email,
    avatar: payload.avatar,
    bio: payload.bio,
  };
}

async function assertPendingRegistrationAvailable(
  email: string,
  username: string,
): Promise<void> {
  const existing = await User.findOne({
    $or: [{ email }, { username }],
  });
  if (!existing) return;

  const field = existing.email === email ? 'email' : 'username';
  throw new OtpWorkflowError(
    409,
    `An account with this ${field} was already registered.`,
  );
}

function createInitialSession(
  user: InstanceType<typeof User>,
  client: AuthenticationClientContext,
) {
  const { deviceOS, deviceBrowser } = parseUserAgent(client.userAgent);
  const sessionId = new mongoose.Types.ObjectId();
  user.sessions = [{
    _id: sessionId,
    userAgent: client.userAgent,
    deviceOS,
    deviceBrowser,
    ipAddress: client.ipAddress,
    lastActive: new Date(),
    authenticatedAt: new Date(),
  }];
  return sessionId;
}
