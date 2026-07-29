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

function asRequestRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}
