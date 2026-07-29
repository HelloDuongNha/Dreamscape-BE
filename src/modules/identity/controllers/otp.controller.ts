import { NextFunction, Request, Response } from 'express';
import {
  parseEmailChangeOtpRequest,
  parseRecoveryEmailRequest,
  parseResendOtpRequest,
  parseVerifyOtpRequest,
} from '../dto/otp.dto';
import {
  beginPasswordRecovery,
  OtpWorkflowError,
  resendEmailChangeWorkflow,
  resendGenericOtp,
  verifyEmailChangeWorkflow,
  verifyOtpWorkflow,
} from '../services/otp/otpWorkflow.service';
import { presentAuthenticatedUser } from '../services/presentation/authenticatedUser.service';
import {
  readIdentityClientContext,
  readIdentityNetworkOrigin,
} from './identityRequestContext';

const PASSWORD_RECOVERY_MESSAGE =
  'If the email matches an active account, a password reset code has been sent.';

export async function verifyOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await verifyOtpWorkflow(
      parseVerifyOtpRequest(req.body),
      readIdentityClientContext(req),
    );

    if (result.kind === 'registration') {
      res.status(201).json({
        success: true,
        message: 'Account verified and created successfully.',
        token: result.token,
        user: presentAuthenticatedUser(result.user),
      });
      return;
    }

    res.status(200).json({
      success: true,
      recoveryGrant: result.recoveryGrant,
      message: 'Code verified successfully. You can now reset your password.',
    });
  } catch (error) {
    handleOtpWorkflowError(error, res, next);
  }
}

export async function verifyEmailChangeOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await verifyEmailChangeWorkflow({
      request: parseEmailChangeOtpRequest(req.body),
      user: req.user!,
      sessionId: req.sessionId,
    });
    res.status(200).json({
      success: true,
      message: 'Email address verified and updated successfully.',
      user: presentAuthenticatedUser(user),
    });
  } catch (error) {
    handleOtpWorkflowError(error, res, next);
  }
}

export async function resendEmailChangeOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const otpState = await resendEmailChangeWorkflow({
      request: parseEmailChangeOtpRequest(req.body),
      userId: String(req.user!._id),
      sessionId: req.sessionId,
    });
    respondWithResentOtp(res, otpState);
  } catch (error) {
    handleOtpWorkflowError(error, res, next);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const otpState = await beginPasswordRecovery(
      parseRecoveryEmailRequest(req.body).email,
      readIdentityNetworkOrigin(req),
    );
    res.status(200).json({
      success: true,
      ...(otpState || {}),
      message: PASSWORD_RECOVERY_MESSAGE,
    });
  } catch (error) {
    handleOtpWorkflowError(error, res, next);
  }
}

export async function resendOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const otpState = await resendGenericOtp(parseResendOtpRequest(req.body));
    respondWithResentOtp(res, otpState);
  } catch (error) {
    handleOtpWorkflowError(error, res, next);
  }
}

function respondWithResentOtp(
  res: Response,
  otpState: { expiresAt: Date; resendAvailableAt: Date },
): void {
  res.status(200).json({
    success: true,
    expiresAt: otpState.expiresAt,
    resendAvailableAt: otpState.resendAvailableAt,
    message: 'A new verification code has been sent to your email.',
  });
}

function handleOtpWorkflowError(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof OtpWorkflowError) {
    res.status(error.statusCode).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
    });
    return;
  }
  next(error);
}
