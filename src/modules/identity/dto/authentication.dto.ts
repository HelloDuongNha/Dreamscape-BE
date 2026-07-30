export interface RegistrationRequestDto {
  username: string;
  display_name: string;
  email: string;
  password: string;
  avatar?: string;
  bio?: string;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface GoogleOnboardingRequestDto {
  onboardingToken: string;
  username: string;
  display_name: string;
  password: string;
  confirmPassword: string;
}

export class IdentityRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityRequestError';
  }
}

export function parseRegistrationRequest(body: unknown): RegistrationRequestDto {
  const input = asRequestRecord(body);
  const username = input.username as string;
  const displayName = input.display_name as string;
  const email = input.email as string;
  const password = input.password as string;

  if (!username || !displayName || !email || !password) {
    throw new IdentityRequestError(400, 'All required fields must be provided.');
  }

  return {
    username,
    display_name: displayName,
    email,
    password,
    avatar: input.avatar as string | undefined,
    bio: input.bio as string | undefined,
  };
}

export function parseLoginRequest(body: unknown): LoginRequestDto {
  const input = asRequestRecord(body);
  return {
    email: input.email as string,
    password: input.password as string,
  };
}

export function parseGoogleOnboardingRequest(body: unknown): GoogleOnboardingRequestDto {
  const input = asRequestRecord(body);
  const onboardingToken = input.onboardingToken as string;
  const username = input.username as string;
  const displayName = input.display_name as string;
  const password = input.password as string;
  const confirmPassword = input.confirmPassword as string;
  if (!onboardingToken || !username || !displayName || !password || !confirmPassword) {
    throw new IdentityRequestError(400, 'All Google registration fields must be provided.');
  }
  return {
    onboardingToken,
    username,
    display_name: displayName,
    password,
    confirmPassword,
  };
}

function asRequestRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}
