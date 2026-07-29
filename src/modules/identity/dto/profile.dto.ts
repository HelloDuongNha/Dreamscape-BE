export interface UpdateProfileRequestDto {
  display_name?: string;
  username?: string;
  bio?: string;
  defaultPrivacy?: 'public' | 'private';
  isPrivateAccount?: boolean;
  dmPrivacy?: 'everyone' | 'following' | 'friends';
  followersPrivacy?: 'everyone' | 'following' | 'only_me';
  followingPrivacy?: 'everyone' | 'following' | 'only_me';
  birth_date?: string;
  birth_hour?: string;
  fullName?: string;
  gender?: string;
}

const PROFILE_FIELDS = [
  'display_name',
  'username',
  'bio',
  'defaultPrivacy',
  'isPrivateAccount',
  'dmPrivacy',
  'followersPrivacy',
  'followingPrivacy',
  'birth_date',
  'birth_hour',
  'fullName',
  'gender',
] as const;

export function parseUpdateProfileRequest(body: unknown): UpdateProfileRequestDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};

  const input = body as Record<string, unknown>;
  return Object.fromEntries(
    PROFILE_FIELDS
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]]),
  ) as UpdateProfileRequestDto;
}
