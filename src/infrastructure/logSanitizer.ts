const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|set-cookie|password|passwordHash|currentPassword|newPassword|confirmPassword|otp|otpCode|verificationCode|accessToken|refreshToken|token|apiKey|apiSecret|secret|credential|encryptionKey|plaintext|ciphertext|authTag|iv|content|message|messageContent|prompt|rawBody)$/i;

const SECRET_QUERY_PARAMETER_PATTERN =
  /([?&](?:token|otp|code|password|secret|key|authorization)=)[^&#\s]*/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JSON_SECRET_PATTERN =
  /("(?:password|passwordHash|currentPassword|newPassword|confirmPassword|otp|otpCode|verificationCode|accessToken|refreshToken|token|apiKey|apiSecret|secret|credential|encryptionKey|plaintext|ciphertext|authTag|iv|content|message|messageContent|prompt|rawBody)"\s*:\s*)"[^"]*"/gi;

export function sanitizeLogValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeLogText(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeLogText(value.message),
      stack: value.stack ? sanitizeLogText(value.stack) : undefined,
    };
  }
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, undefined, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeLogValue(entryValue, entryKey, seen),
    ]),
  );
}

export function sanitizeLogText(value: string): string {
  const withoutBearerTokens = value.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
  const withoutSecretQueryValues = withoutBearerTokens.replace(
    SECRET_QUERY_PARAMETER_PATTERN,
    '$1[REDACTED]',
  );
  const withoutJsonSecrets = withoutSecretQueryValues.replace(
    JSON_SECRET_PATTERN,
    '$1"[REDACTED]"',
  );

  if (!/\b(?:otp|verification code)\b/i.test(withoutJsonSecrets)) {
    return withoutJsonSecrets;
  }
  return withoutJsonSecrets.replace(/\b\d{6}\b/g, '[REDACTED]');
}
