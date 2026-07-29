import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  AvatarUploadError,
  replaceUserAvatar,
} from '../services/avatar.service';

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: AVATAR_MAX_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    const accepted = AVATAR_ALLOWED_MIME_TYPES.includes(file.mimetype as never);
    if (!accepted) {
      callback(new AvatarUploadError(
        'avatar_type_invalid',
        400,
        'Avatar must be a JPEG, PNG, or WebP image.',
      ));
      return;
    }
    callback(null, true);
  },
});

export function uploadAvatarMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  avatarUpload.single('avatar')(req, res, error => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AvatarUploadError('avatar_size_invalid', 400, 'Avatar must be 5 MB or smaller.'));
      return;
    }
    next(error);
  });
}

export async function replaceAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const avatar = await replaceUserAvatar(String(req.user!._id), req.file);
    res.status(200).json({
      success: true,
      avatar,
    });
  } catch (error) {
    next(error);
  }
}
