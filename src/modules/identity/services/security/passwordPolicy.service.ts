const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export class PasswordPolicyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      'password_length_invalid',
      400,
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new PasswordPolicyError(
      'password_complexity_invalid',
      400,
      'Password must include an uppercase letter, a lowercase letter, and a number.',
    );
  }
}

export function assertPasswordConfirmation(password: string, confirmation: string): void {
  if (password !== confirmation) {
    throw new PasswordPolicyError(
      'password_confirmation_mismatch',
      400,
      'Password confirmation does not match.',
    );
  }
}
