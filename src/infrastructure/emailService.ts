import nodemailer from 'nodemailer';
import { getOtpEmailTemplate } from '../templates/otpTemplate';

// Configure a secure transporter pool on port 465
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: true, // port 465 requires secure: true
  pool: true,
  auth: {
    user: process.env.SMTP_USER || 'dreamscape.app.service@gmail.com',
    pass: process.env.SMTP_PASS || 'uojojprejzyrzojg',
  },
});

/**
 * Sends an OTP email to the user using Google SMTP and nodemailer.
 * Wrapped in a strict try/catch to prevent email delivery failures from crashing
 * the request flow with a 500 error.
 */
export const sendOtpEmail = async (
  email: string,
  otpCode: string,
  purpose: 'register' | 'update_email' | 'forgot_password',
): Promise<void> => {
  try {
    let purposeLabel = 'Registration';
    if (purpose === 'update_email') {
      purposeLabel = 'Email Modification';
    } else if (purpose === 'forgot_password') {
      purposeLabel = 'Password Recovery';
    }

    const html = getOtpEmailTemplate(otpCode, purposeLabel);

    await transporter.sendMail({
      from: '"DreamScape" <dreamscape.app.service@gmail.com>',
      to: email,
      subject: `DreamScape Verification Code - ${otpCode}`,
      html,
    });
    console.log(`[SMTP] Successfully sent OTP code ${otpCode} to ${email} for purpose: ${purpose}`);
  } catch (error) {
    console.error(`[SMTP] Failed to send OTP email to ${email} for purpose: ${purpose}:`, error);
    // Explicitly swallow/handle error to prevent crashing the server flow with a 500 error
  }
};
