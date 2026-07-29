import { NextFunction, Request, Response } from 'express';
import { parseUpdateProfileRequest } from '../dto/profile.dto';
import {
  ProfileUpdateError,
  updateIdentityProfile,
} from '../services/profile/profileUpdate.service';
import { presentAuthenticatedUser } from '../services/presentation/authenticatedUser.service';

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await updateIdentityProfile(
      req.user!._id,
      parseUpdateProfileRequest(req.body),
    );
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: presentAuthenticatedUser(user),
    });
  } catch (error) {
    if (error instanceof ProfileUpdateError) {
      res.status(error.statusCode).json({
        success: false,
        ...(error.field ? { field: error.field } : {}),
        message: error.message,
      });
      return;
    }
    next(error);
  }
}
