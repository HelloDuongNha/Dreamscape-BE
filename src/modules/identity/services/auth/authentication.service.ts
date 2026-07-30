import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { getFirebaseAuth } from '../../../../config/firebaseAdmin';
import {
  requireEnvironmentSecret,
  requireEnvironmentVariable,
} from '../../../../config/env';
import {
  LoginRequestDto,
  RegistrationRequestDto,
} from '../../dto/authentication.dto';
import User from '../../models/User';
import { issueOtp } from '../otp/otpLifecycle.service';
import { assertPasswordPolicy } from '../security/passwordPolicy.service';
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

  const email = decoded.email.trim().toLowerCase();
  let user = await User.findOne({ googleUid: decoded.uid }).select('+googleUid');
  if (!user) {
    user = await User.findOne({ email }).select('+googleUid');
    if (user?.googleUid && user.googleUid !== decoded.uid) {
      throw new AuthenticationError(409, 'This email is linked to another Google identity.');
    }
    if (user) {
      user.googleUid = decoded.uid;
      user.authMethod = user.authMethod === 'password' ? 'password_google' : 'google';
    } else {
      user = new User({
        username: await availableGoogleUsername(email),
        display_name: decoded.name?.trim() || email.split('@')[0],
        email,
        googleUid: decoded.uid,
        authMethod: 'google',
        avatar: decoded.picture || '',
        role: 'user',
      });
    }
  }

  const sessionId = appendAuthenticatedSession(user, client);
  await user.save();
  return {
    token: signIdentityToken(String(user._id), String(sessionId)),
    user,
  };
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

async function assertRegistrationIdentityAvailable(email: string, username: string) {
  const existing = await User.findOne({
    $or: [{ email }, { username }],
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
