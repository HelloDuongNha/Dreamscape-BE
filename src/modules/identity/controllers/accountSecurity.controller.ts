import type { NextFunction, Request, Response } from 'express';
import {
  beginEmailChange,
  changePasswordWithCurrent,
  createRecoverySessionRevocationGrant,
  resetPasswordWithGrant,
  revokeAllOtherSessions,
  revokeSessionsWithRecoveryGrant,
} from '../services/security/accountSecurity.service';
import { readIdentityNetworkOrigin } from './identityRequestContext';

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
    const emailChange = await beginEmailChange({
      user: req.user!,
      sessionId: req.sessionId,
      email: req.body.email,
      currentPassword: req.body.currentPassword,
      requestOrigin: readIdentityNetworkOrigin(req),
    });
    res.status(200).json({
      success: true,
      status: 'pending',
      email: emailChange.email,
      expiresAt: emailChange.expiresAt,
      resendAvailableAt: emailChange.resendAvailableAt,
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
