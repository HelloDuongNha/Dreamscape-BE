import { NextFunction, Request, Response } from 'express';
import {
  IdentityRequestError,
  parseGoogleOnboardingRequest,
  parseLoginRequest,
  parseRegistrationRequest,
} from '../dto/authentication.dto';
import {
  AuthenticationError,
  authenticateWithGoogle,
  authenticateWithPassword,
  beginRegistration,
  completeGoogleRegistration,
} from '../services/auth/authentication.service';
import { removeCurrentSession } from '../services/auth/sessionLifecycle.service';
import { presentAuthenticatedUser } from '../services/presentation/authenticatedUser.service';
import {
  readIdentityClientContext,
  readIdentityNetworkOrigin,
} from './identityRequestContext';

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = parseRegistrationRequest(req.body);
    const registration = await beginRegistration(
      input,
      readIdentityNetworkOrigin(req),
    );

    res.status(200).json({
      success: true,
      status: 'pending',
      email: registration.email,
      expiresAt: registration.expiresAt,
      resendAvailableAt: registration.resendAvailableAt,
      message: 'Verification OTP sent to your email. Please verify to complete registration.',
    });
  } catch (error) {
    handleAuthenticationError(error, res, next);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authenticated = await authenticateWithPassword(
      parseLoginRequest(req.body),
      readIdentityClientContext(req),
    );

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      token: authenticated.token,
      user: presentAuthenticatedUser(authenticated.user),
    });
  } catch (error) {
    handleAuthenticationError(error, res, next);
  }
}

export async function googleLogin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
    const authenticated = await authenticateWithGoogle(
      idToken,
      readIdentityClientContext(req),
    );
    if (authenticated.status === 'onboarding_required') {
      res.status(200).json({ success: true, ...authenticated });
      return;
    }
    res.status(200).json({
      success: true,
      status: authenticated.status,
      message: 'Google sign-in successful.',
      token: authenticated.token,
      user: presentAuthenticatedUser(authenticated.user),
    });
  } catch (error) {
    handleAuthenticationError(error, res, next);
  }
}

export async function completeGoogleOnboarding(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authenticated = await completeGoogleRegistration(
      parseGoogleOnboardingRequest(req.body),
      readIdentityClientContext(req),
    );
    res.status(201).json({
      success: true,
      status: 'authenticated',
      message: 'Google registration completed.',
      token: authenticated.token,
      user: presentAuthenticatedUser(authenticated.user),
    });
  } catch (error) {
    handleAuthenticationError(error, res, next);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await removeCurrentSession(req.user!, req.sessionId);
    res.status(200).json({
      success: true,
      message: 'Logged out successfully. Please discard your token on the client.',
    });
  } catch (error) {
    next(error);
  }
}

function handleAuthenticationError(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof AuthenticationError || error instanceof IdentityRequestError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
}
