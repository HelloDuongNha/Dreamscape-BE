import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { getFirebaseAuth } from '../../../../config/firebaseAdmin';
import {
  requireEnvironmentSecret,
  requireEnvironmentVariable,
} from '../../../../config/env';
import {
  GoogleOnboardingRequestDto,
  LoginRequestDto,
  RegistrationRequestDto,
} from '../../dto/authentication.dto';
import User from '../../models/User';
import { issueOtp } from '../otp/otpLifecycle.service';
import {
  assertPasswordConfirmation,
  assertPasswordPolicy,
} from '../security/passwordPolicy.service';
import { parseUserAgent } from './userAgent.service';

export interface AuthenticationClientContext {
  userAgent: string;
  ipAddress: string;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export async function beginRegistration(
  input: RegistrationRequestDto,
  requestOrigin: string,
) {
  assertPasswordPolicy(input.password);

  const registration = normalizeRegistration(input);
  await assertRegistrationIdentityAvailable(registration.email, registration.username);

  const passwordHash = await bcrypt.hash(input.password, 12);
  const otpState = await issueOtp({
    email: registration.email,
    purpose: 'register',
    requestOrigin,
    payload: {
      username: registration.username,
      display_name: registration.displayName,
      email: registration.email,
      passwordHash,
      avatar: input.avatar ?? '',
      bio: input.bio ?? '',
    },
  });

  return {
    email: registration.email,
    expiresAt: otpState.expiresAt,
    resendAvailableAt: otpState.resendAvailableAt,
  };
}

export async function authenticateWithPassword(
  input: LoginRequestDto,
  client: AuthenticationClientContext,
) {
  const user = await User.findOne({ email: input.email }).select('+password');
  if (!user || !(await user.comparePassword(input.password))) {
    throw new AuthenticationError(401, 'Invalid email or password.');
  }

  const sessionId = appendAuthenticatedSession(user, client);
  await user.save();

  return {
    token: signIdentityToken(String(user._id), String(sessionId)),
    user,
  };
}

export async function authenticateWithGoogle(
  idToken: string,
  client: AuthenticationClientContext,
) {
  const decoded = await verifyGoogleIdToken(idToken);
  const email = decoded.email.trim().toLowerCase();
  let user = await User.findOne({ googleUid: decoded.uid }).select('+googleUid +password');
  if (!user) {
    user = await User.findOne({ email }).select('+googleUid +password');
    if (user?.googleUid && user.googleUid !== decoded.uid) {
      throw new AuthenticationError(409, 'This email is linked to another Google identity.');
    }
    if (user) {
      user.googleUid = decoded.uid;
      user.authMethod = user.authMethod === 'password' ? 'password_google' : 'google';
    } else {
      return buildGoogleOnboarding(decoded.uid, email, decoded.name, decoded.picture);
    }
  }
  if (!user.password || user.authMethod === 'google') {
    return buildGoogleOnboarding(
      decoded.uid,
      email,
      user.display_name || decoded.name,
      user.avatar || decoded.picture,
      String(user._id),
      user.username,
    );
  }

  const sessionId = appendAuthenticatedSession(user, client);
  await user.save();
  return {
    status: 'authenticated' as const,
    token: signIdentityToken(String(user._id), String(sessionId)),
    user,
  };
}

export async function completeGoogleRegistration(
  input: GoogleOnboardingRequestDto,
  client: AuthenticationClientContext,
) {
  assertPasswordPolicy(input.password);
  assertPasswordConfirmation(input.password, input.confirmPassword);
  const identity = verifyGoogleOnboardingToken(input.onboardingToken);
  const registration = normalizeRegistration({
    username: input.username,
    display_name: input.display_name,
    email: identity.email,
    password: input.password,
  });
  const existingUser = identity.existingUserId
    ? await User.findOne({ _id: identity.existingUserId, googleUid: identity.googleUid })
      .select('+googleUid +password')
    : null;
  await assertRegistrationIdentityAvailable(
    registration.email,
    registration.username,
    existingUser?._id,
  );

  const user = existingUser || new User({
    email: registration.email,
    googleUid: identity.googleUid,
    avatar: identity.avatar,
    role: 'user',
  });
  user.username = registration.username;
  user.display_name = registration.displayName;
  user.password = input.password;
  user.authMethod = 'password_google';
  if (!user.avatar && identity.avatar) user.avatar = identity.avatar;
  const sessionId = appendAuthenticatedSession(user, client);
  await user.save();
  return {
    token: signIdentityToken(String(user._id), String(sessionId)),
    user,
  };
}

async function verifyGoogleIdToken(idToken: string) {
  if (!idToken.trim()) throw new AuthenticationError(400, 'Google ID token is required.');
  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken, true);
  } catch {
    throw new AuthenticationError(401, 'Google sign-in could not be verified.');
  }
  if (decoded.firebase?.sign_in_provider !== 'google.com') {
    throw new AuthenticationError(401, 'The verified identity is not a Google sign-in.');
  }
  if (!decoded.email || decoded.email_verified !== true) {
    throw new AuthenticationError(401, 'Google must verify the account email first.');
  }
  return decoded as typeof decoded & { email: string };
}

async function buildGoogleOnboarding(
  googleUid: string,
  email: string,
  displayName?: string,
  avatar?: string,
  existingUserId?: string,
  existingUsername?: string,
) {
  const profile = {
    email,
    username: existingUsername || await availableGoogleUsername(email),
    display_name: displayName?.trim() || email.split('@')[0],
    avatar: avatar || '',
  };
  const secret = requireEnvironmentSecret('JWT_SECRET');
  return {
    status: 'onboarding_required' as const,
    onboardingToken: jwt.sign(
      {
        purpose: 'google_onboarding',
        googleUid,
        email,
        avatar: profile.avatar,
        ...(existingUserId ? { existingUserId } : {}),
      },
      secret,
      { expiresIn: '10m' },
    ),
    profile,
  };
}

function verifyGoogleOnboardingToken(token: string): {
  googleUid: string;
  email: string;
  avatar: string;
  existingUserId?: string;
} {
  try {
    const payload = jwt.verify(token, requireEnvironmentSecret('JWT_SECRET')) as jwt.JwtPayload;
    if (
      payload.purpose !== 'google_onboarding'
      || typeof payload.googleUid !== 'string'
      || typeof payload.email !== 'string'
    ) {
      throw new Error('invalid_google_onboarding_claims');
    }
    return {
      googleUid: payload.googleUid,
      email: payload.email.trim().toLowerCase(),
      avatar: typeof payload.avatar === 'string' ? payload.avatar : '',
      existingUserId: typeof payload.existingUserId === 'string'
        ? payload.existingUserId
        : undefined,
    };
  } catch {
    throw new AuthenticationError(401, 'Google registration session expired. Please try again.');
  }
}

export function signIdentityToken(userId: string, sessionId?: string): string {
  const secret = requireEnvironmentSecret('JWT_SECRET');
  const expiresIn = requireEnvironmentVariable(
    'JWT_EXPIRES_IN',
  ) as jwt.SignOptions['expiresIn'];
  return jwt.sign({ id: userId, sessionId }, secret, { expiresIn });
}

function normalizeRegistration(input: RegistrationRequestDto) {
  const trimmedUsername = input.username.trim();
  return {
    username: trimmedUsername.startsWith('@') ? trimmedUsername : `@${trimmedUsername}`,
    displayName: input.display_name.trim(),
    email: input.email.toLowerCase(),
  };
}

async function assertRegistrationIdentityAvailable(
  email: string,
  username: string,
  excludedUserId?: mongoose.Types.ObjectId,
) {
  const existing = await User.findOne({
    $or: [{ email }, { username }],
    ...(excludedUserId ? { _id: { $ne: excludedUserId } } : {}),
  });
  if (!existing) return;

  const field = existing.email.toLowerCase() === email ? 'email' : 'username';
  throw new AuthenticationError(409, `An account with this ${field} already exists.`);
}

export function appendAuthenticatedSession(
  user: InstanceType<typeof User>,
  client: AuthenticationClientContext,
) {
  const { deviceOS, deviceBrowser } = parseUserAgent(client.userAgent);
  const sessionId = new mongoose.Types.ObjectId();

  user.sessions.push({
    _id: sessionId,
    userAgent: client.userAgent,
    deviceOS,
    deviceBrowser,
    ipAddress: client.ipAddress,
    lastActive: new Date(),
    authenticatedAt: new Date(),
  });

  if (user.sessions.length > 20) {
    user.sessions.shift();
  }
  return sessionId;
}

async function availableGoogleUsername(email: string): Promise<string> {
  const localPart = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/gu, '');
  const base = (localPart || 'dreamer').slice(0, 24);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const username = `@${base.slice(0, 29 - suffix.length)}${suffix}`;
    if (!(await User.exists({ username }))) return username;
  }
  throw new AuthenticationError(409, 'Could not allocate a unique username for this account.');
}
