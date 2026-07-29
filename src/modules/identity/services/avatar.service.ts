import User from '../models/User';
import {
  deleteAsset,
  uploadUserAvatar,
} from '../../../infrastructure/storage/cloudinaryStorage.service';
import { logger } from '../../../infrastructure/logger';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

type AvatarMimeType = typeof AVATAR_ALLOWED_MIME_TYPES[number];

export class AvatarUploadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AvatarUploadError';
  }
}

interface AvatarStorage {
  upload(buffer: Buffer, userId: string): ReturnType<typeof uploadUserAvatar>;
  remove(publicId: string): Promise<unknown>;
}

const cloudinaryAvatarStorage: AvatarStorage = {
  upload: uploadUserAvatar,
  remove: publicId => deleteAsset(publicId, 'image'),
};

export async function replaceUserAvatar(
  userId: string,
  file: Express.Multer.File | undefined,
  storage: AvatarStorage = cloudinaryAvatarStorage,
): Promise<string> {
  const avatar = validateAvatarFile(file);
  const user = await User.findById(userId);
  if (!user) {
    throw new AvatarUploadError('user_not_found', 404, 'User not found.');
  }

  const previousAsset = user.avatarAsset?.provider === 'cloudinary'
    ? user.avatarAsset.publicId
    : null;
  const uploaded = await storage.upload(avatar.buffer, userId);

  try {
    user.avatar = uploaded.secure_url;
    user.avatarAsset = {
      provider: 'cloudinary',
      publicId: uploaded.public_id,
    };
    await user.save();
  } catch (error) {
    await removeUploadedAssetAfterFailedSave(storage, uploaded.public_id, userId);
    throw error;
  }

  if (previousAsset && previousAsset !== uploaded.public_id) {
    await removePreviousAvatar(storage, previousAsset, userId);
  }

  return user.avatar;
}

function validateAvatarFile(
  file: Express.Multer.File | undefined,
): Express.Multer.File {
  if (!file) {
    throw new AvatarUploadError('avatar_required', 400, 'Choose an avatar image to upload.');
  }
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    throw new AvatarUploadError('avatar_size_invalid', 400, 'Avatar must be 5 MB or smaller.');
  }
  if (!AVATAR_ALLOWED_MIME_TYPES.includes(file.mimetype as AvatarMimeType)) {
    throw new AvatarUploadError('avatar_type_invalid', 400, 'Avatar must be a JPEG, PNG, or WebP image.');
  }
  if (!matchesImageSignature(file.buffer, file.mimetype as AvatarMimeType)) {
    throw new AvatarUploadError('avatar_content_invalid', 400, 'The selected file is not a valid image.');
  }
  return file;
}

function matchesImageSignature(buffer: Buffer, mimeType: AvatarMimeType): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

async function removeUploadedAssetAfterFailedSave(
  storage: AvatarStorage,
  publicId: string,
  userId: string,
): Promise<void> {
  try {
    await storage.remove(publicId);
  } catch (cleanupError) {
    logger.warn('Could not remove a new avatar after profile persistence failed.', {
      userId,
      publicId,
      cleanupError,
    });
  }
}

async function removePreviousAvatar(
  storage: AvatarStorage,
  publicId: string,
  userId: string,
): Promise<void> {
  try {
    await storage.remove(publicId);
  } catch (cleanupError) {
    // The new avatar is already committed; cleanup must not roll back a valid profile update.
    logger.warn('Could not remove the previous avatar after replacement.', {
      userId,
      publicId,
      cleanupError,
    });
  }
}
