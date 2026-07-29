import '../config/env';
import nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';
import { getOtpEmailTemplate } from '../templates/otpTemplate';
import { logger } from './logger';
import { requireEnvironmentVariable } from '../config/env';

type OtpPurpose = 'register' | 'update_email' | 'forgot_password';

interface EmailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

interface OtpMailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

interface OtpEmailInput {
  email: string;
  otpCode: string;
  purpose: OtpPurpose;
  from: string;
}

let transporter: Transporter | null = null;

export class EmailDeliveryError extends Error {
  constructor() {
    super('Verification email could not be sent. Please try again later.');
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Sends an OTP email to the user using Google SMTP and nodemailer.
 * Wrapped in a strict try/catch to prevent email delivery failures from crashing
 * the request flow with a 500 error.
 */
export const sendOtpEmail = async (
  email: string,
  otpCode: string,
  purpose: OtpPurpose,
): Promise<void> => {
  try {
    const config = resolveEmailTransportConfig();
    await deliverOtpEmail(
      { email, otpCode, purpose, from: config.from },
      getTransporter(config),
    );
  } catch (error) {
    logger.error('Verification email delivery failed', error, { purpose });
    throw new EmailDeliveryError();
  }
};

export async function deliverOtpEmail(
  input: OtpEmailInput,
  mailTransport: OtpMailTransport,
): Promise<void> {
  const html = getOtpEmailTemplate(input.otpCode, resolvePurposeLabel(input.purpose));
  await mailTransport.sendMail({
    from: input.from,
    to: input.email,
    subject: 'Your DreamScape verification code',
    html,
  });
  logger.info('Verification email sent', { purpose: input.purpose });
}

export function resolveEmailTransportConfig(): EmailTransportConfig {
  const host = requireEnvironmentVariable('SMTP_HOST');
  const user = requireEnvironmentVariable('SMTP_USER');
  const password = requireEnvironmentVariable('SMTP_PASS');
  const configuredFrom = process.env.SMTP_FROM?.trim();

  const port = Number.parseInt(requireEnvironmentVariable('SMTP_PORT'), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE?.trim().toLowerCase() === 'true' || port === 465,
    user,
    password,
    from: configuredFrom || `"DreamScape" <${user}>`,
  };
}

function getTransporter(config: EmailTransportConfig): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    pool: true,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
  return transporter;
}

function resolvePurposeLabel(purpose: OtpPurpose): string {
  if (purpose === 'update_email') return 'Email Modification';
  if (purpose === 'forgot_password') return 'Password Recovery';
  return 'Registration';
}
