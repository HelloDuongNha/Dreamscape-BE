import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import User from '../../identity/models/User';
import { sanitizeOtherUser } from '../../identity/services/userProfileSanitizer.service';
import Notification from '../models/Notification';

/**
 * POST /api/users/:id/follow
 * Follow or unfollow a user and emit a notification for a new follow.
 */
export const toggleFollow = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const myId = String(req.user!._id);
    const targetId = String(req.params.id);

    if (!Types.ObjectId.isValid(targetId)) {
      res.status(400).json({ success: false, message: 'Invalid target user ID format.' });
      return;
    }

    if (myId === targetId) {
      res.status(400).json({ success: false, message: 'You cannot follow yourself.' });
      return;
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const currentUser = await User.findById(myId);
    if (!currentUser) {
      res.status(404).json({ success: false, message: 'Current user not found.' });
      return;
    }

    if (!targetUser.followers) targetUser.followers = [];
    if (!currentUser.following) currentUser.following = [];

    const isFollowing = currentUser.following
      .map((id: any) => id.toString())
      .includes(targetId);

    if (isFollowing) {
      currentUser.following = currentUser.following.filter(id => id.toString() !== targetId);
      targetUser.followers = targetUser.followers.filter(id => id.toString() !== myId);
    } else {
      currentUser.following.push(new Types.ObjectId(targetId));
      targetUser.followers.push(new Types.ObjectId(myId));
    }

    targetUser.follower_count = targetUser.followers.length;

    await currentUser.save();
    await targetUser.save();

    if (!isFollowing) {
      try {
        const notification = await Notification.create({
          recipientId: targetUser._id,
          senderId: new Types.ObjectId(myId),
          type: 'follow',
        });
        await notification.populate('senderId', 'username display_name avatar');
        const io = req.app.get('io');
        if (io) {
          io.to(targetId).emit('new_notification', notification);
        }
      } catch (error) {
        console.error('❌ Failed to trigger follow notification:', error);
      }
    }

    const updatedTargetUser = await User.findById(targetId)
      .populate('followers', 'username display_name avatar')
      .populate('following', 'username display_name avatar');

    res.status(200).json({
      success: true,
      following: !isFollowing,
      user: updatedTargetUser
        ? sanitizeOtherUser(updatedTargetUser, myId)
        : sanitizeOtherUser(targetUser, myId),
    });
  } catch (error) {
    next(error);
  }
};
