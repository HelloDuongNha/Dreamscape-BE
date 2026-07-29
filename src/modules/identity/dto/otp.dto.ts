import { OtpPurpose } from '../models/Otp';

export interface VerifyOtpRequestDto {
  email?: string;
  otpCode?: string;
  purpose?: OtpPurpose;
}

export interface EmailChangeOtpRequestDto {
  email?: string;
  otpCode?: string;
}

export interface ResendOtpRequestDto {
  email?: string;
  purpose?: OtpPurpose;
}

export function parseVerifyOtpRequest(body: unknown): VerifyOtpRequestDto {
  const input = requestRecord(body);
  return {
    email: input.email as string | undefined,
    otpCode: input.otpCode as string | undefined,
    purpose: input.purpose as OtpPurpose | undefined,
  };
}

export function parseEmailChangeOtpRequest(body: unknown): EmailChangeOtpRequestDto {
  const input = requestRecord(body);
  return {
    email: input.email as string | undefined,
    otpCode: input.otpCode as string | undefined,
  };
}

export function parseResendOtpRequest(body: unknown): ResendOtpRequestDto {
  const input = requestRecord(body);
  return {
    email: input.email as string | undefined,
    purpose: input.purpose as OtpPurpose | undefined,
  };
}

export function parseRecoveryEmailRequest(body: unknown): { email?: string } {
  return { email: requestRecord(body).email as string | undefined };
}

function requestRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}
