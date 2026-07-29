import type { NextFunction, Request, Response } from 'express';
import User from '../models/User';
import { issueOtp } from '../services/otp/otpLifecycle.service';
import {
  assertEmailChangeAuthorization,
  changePasswordWithCurrent,
  createRecoverySessionRevocationGrant,
  resetPasswordWithGrant,
  revokeAllOtherSessions,
  revokeSessionsWithRecoveryGrant,
} from '../services/security/accountSecurity.service';

function requesterNetworkOrigin(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || 'unknown';
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.socket.remoteAddress || 'unknown';
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      res.status(400).json({ success: false, code: 'password_fields_required', message: 'All password fields are required.' });
      return;
    }
    await changePasswordWithCurrent({
      userId: String(req.user!._id),
      sessionId: req.sessionId,
      currentPassword,
      newPassword,
      confirmPassword,
    });
    res.status(200).json({ success: true, securityChange: 'password', message: 'Password updated successfully.' });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, recoveryGrant, newPassword, confirmPassword } = req.body;
    if (!email || !recoveryGrant || !newPassword || !confirmPassword) {
      res.status(400).json({ success: false, code: 'password_fields_required', message: 'Email, recovery grant, and both password fields are required.' });
      return;
    }
    const userId = await resetPasswordWithGrant({ email, recoveryGrant, newPassword, confirmPassword });
    res.status(200).json({
      success: true,
      securityChange: 'password',
      sessionRevocationGrant: createRecoverySessionRevocationGrant(userId),
      message: 'Password reset successfully.',
    });
  } catch (error) {
    next(error);
  }
}

export async function startEmailChange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !req.sessionId) {
      res.status(400).json({ success: false, code: 'email_change_invalid', message: 'A valid new email and active session are required.' });
      return;
    }
    if (email === req.user!.email) {
      res.status(409).json({ success: false, code: 'email_unchanged', message: 'New email must be different from the current email.' });
      return;
    }
    if (await User.exists({ email, _id: { $ne: req.user!._id } })) {
      res.status(409).json({ success: false, code: 'email_already_used', message: 'Email address is already taken.' });
      return;
    }
    await assertEmailChangeAuthorization({
      user: req.user!,
      sessionId: req.sessionId,
      currentPassword: req.body.currentPassword,
    });
    const otpState = await issueOtp({
      email,
      purpose: 'update_email',
      subjectUserId: String(req.user!._id),
      sessionId: req.sessionId,
      requestOrigin: requesterNetworkOrigin(req),
      payload: { email },
    });
    res.status(200).json({
      success: true,
      status: 'pending',
      email,
      expiresAt: otpState.expiresAt,
      resendAvailableAt: otpState.resendAvailableAt,
      message: 'Verification code sent to your new email.',
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeOtherSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const revokedCount = await revokeAllOtherSessions(req.user!, req.sessionId);
    res.status(200).json({ success: true, revokedCount, message: 'Other sessions were signed out successfully.' });
  } catch (error) {
    next(error);
  }
}

export async function revokeRecoveredSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grant = String(req.body.sessionRevocationGrant || '');
    if (!grant) {
      res.status(400).json({ success: false, code: 'session_revocation_grant_required', message: 'Session revocation grant is required.' });
      return;
    }
    const revokedCount = await revokeSessionsWithRecoveryGrant(grant);
    res.status(200).json({ success: true, revokedCount, message: 'All previous sessions were signed out.' });
  } catch (error) {
    next(error);
  }
}
