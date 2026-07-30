import mongoose from 'mongoose';
import { UpdateProfileRequestDto } from '../../dto/profile.dto';
import User from '../../models/User';

export class ProfileUpdateError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ProfileUpdateError';
  }
}

export async function updateIdentityProfile(
  userId: mongoose.Types.ObjectId | string,
  input: UpdateProfileRequestDto,
) {
  assertUpdatePayloadPresent(input);

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new ProfileUpdateError(404, 'User not found.');
  }

  applyDisplayName(user, input.display_name);
  await applyUsername(user, userId, input.username);
  applyProfileText(user, input);
  applyPrivacySettings(user, input);
  applyPersonalDetails(user, input);

  await user.save();
  return user;
}

function assertUpdatePayloadPresent(input: UpdateProfileRequestDto): void {
  if (Object.values(input).every((value) => value === undefined)) {
    throw new ProfileUpdateError(400, 'Update payload cannot be empty.');
  }
}

function applyDisplayName(
  user: InstanceType<typeof User>,
  displayName: string | undefined,
): void {
  if (displayName === undefined) return;
  if (!displayName || displayName.trim() === '') {
    throw new ProfileUpdateError(400, 'Display name cannot be empty.');
  }
  user.display_name = displayName.trim();
}

async function applyUsername(
  user: InstanceType<typeof User>,
  userId: mongoose.Types.ObjectId | string,
  username: string | undefined,
): Promise<void> {
  if (username === undefined) return;

  const trimmed = username.trim();
  const formatted = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  if (formatted === '@') {
    throw new ProfileUpdateError(400, 'Username cannot be empty.');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(formatted.slice(1))) {
    throw new ProfileUpdateError(
      400,
      'Username can only contain letters, numbers, and underscores after the @.',
    );
  }
  if (formatted.length < 3 || formatted.length > 30) {
    throw new ProfileUpdateError(400, 'Username must be between 3 and 30 characters.');
  }

  const existing = await User.findOne({ username: formatted, _id: { $ne: userId } });
  if (existing) {
    throw new ProfileUpdateError(409, 'Username is already taken.', 'username');
  }
  user.username = formatted;
}

function applyProfileText(
  user: InstanceType<typeof User>,
  input: UpdateProfileRequestDto,
): void {
  if (input.bio !== undefined) {
    user.bio = input.bio.trim();
  }
}

function applyPrivacySettings(
  user: InstanceType<typeof User>,
  input: UpdateProfileRequestDto,
): void {
  if (input.defaultPrivacy !== undefined) {
    if (!['public', 'private'].includes(input.defaultPrivacy)) {
      throw new ProfileUpdateError(400, 'Invalid default privacy mode.');
    }
    user.defaultPrivacy = input.defaultPrivacy;
  }
  if (input.isPrivateAccount !== undefined) {
    user.isPrivateAccount = input.isPrivateAccount;
    if (input.isPrivateAccount === false) {
      user.followRequests = [];
    }
  }
  if (input.dmPrivacy !== undefined) {
    if (!['everyone', 'following', 'friends'].includes(input.dmPrivacy)) {
      throw new ProfileUpdateError(400, 'Invalid DM privacy setting.');
    }
    user.dmPrivacy = input.dmPrivacy;
  }
  if (input.followersPrivacy !== undefined) {
    if (!['everyone', 'following', 'only_me'].includes(input.followersPrivacy)) {
      throw new ProfileUpdateError(400, 'Invalid followers privacy setting.');
    }
    user.followersPrivacy = input.followersPrivacy;
  }
  if (input.followingPrivacy !== undefined) {
    if (!['everyone', 'following', 'only_me'].includes(input.followingPrivacy)) {
      throw new ProfileUpdateError(400, 'Invalid following privacy setting.');
    }
    user.followingPrivacy = input.followingPrivacy;
  }
}

function applyPersonalDetails(
  user: InstanceType<typeof User>,
  input: UpdateProfileRequestDto,
): void {
  const mutableUser = user as any;
  if (input.birth_date !== undefined) mutableUser.birth_date = input.birth_date;
  if (input.birth_hour !== undefined) mutableUser.birth_hour = input.birth_hour;
  if (input.fullName !== undefined) mutableUser.fullName = input.fullName;
  if (input.gender !== undefined) mutableUser.gender = input.gender;
}
