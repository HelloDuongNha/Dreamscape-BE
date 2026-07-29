import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
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

function appendAuthenticatedSession(
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
