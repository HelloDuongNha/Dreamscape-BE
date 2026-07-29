import { NextFunction, Request, Response } from 'express';
import {
  FollowLifecycleError,
  reviewFollowRequest,
  toggleUserFollow,
} from '../services/follow/followLifecycle.service';

export async function toggleFollow(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await toggleUserFollow({
      userId: String(req.user!._id),
      targetUserId: String(req.params.id),
      socketServer: req.app.get('io'),
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof FollowLifecycleError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}

export async function reviewPendingFollowRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const action = req.body?.action;
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({
        success: false,
        message: 'action must be "approve" or "reject".',
      });
      return;
    }
    const result = await reviewFollowRequest({
      ownerId: String(req.user!._id),
      requesterId: String(req.params.requesterId),
      action,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof FollowLifecycleError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
}
