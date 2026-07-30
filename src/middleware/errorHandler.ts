import { Request, Response, NextFunction } from 'express';
import { EmailDeliveryError } from '../infrastructure/emailService';
import { logger } from '../infrastructure/logger';
import { OtpFlowError } from '../modules/identity/services/otp/otpLifecycle.service';
import {
  AccountSecurityError,
  PasswordPolicyError,
} from '../modules/identity/services/security/accountSecurity.service';
import { AvatarUploadError } from '../modules/identity/services/avatar/avatar.service';

/**
 * Global error-handling middleware.
 * Must be registered last (after all routes) in app.ts.
 */
const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error('Unhandled request error', err);

  if (err instanceof OtpFlowError) {
    res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      ...err.details,
    });
    return;
  }
  if (err instanceof AccountSecurityError || err instanceof PasswordPolicyError) {
    res.status(err.status).json({ success: false, code: err.code, message: err.message });
    return;
  }
  if (err instanceof AvatarUploadError) {
    res.status(err.status).json({ success: false, code: err.code, message: err.message });
    return;
  }
  if (err instanceof EmailDeliveryError) {
    res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
  });
};

export default errorHandler;
