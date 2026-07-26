import { Request, Response } from 'express';
import Notification from '../models/Notification';

/**
 * GET /api/notifications
 * Fetch all notifications for the logged-in user, sorted newest first.
 */
export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId = req.user!._id;

    const notifications = await Notification.find({ recipientId: myId })
      .sort({ timestamp: -1 })
      .populate('senderId', 'username display_name avatar')
      .populate('postId', 'content') // optional but helpful
      .lean();

    res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications.',
      error: err,
    });
  }
};

/**
 * PATCH /api/notifications/mark-read
 * Mark all notifications for the current user as read (isRead = true).
 */
export const markNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId = req.user!._id;

    await Notification.updateMany(
      { recipientId: myId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read.',
      error: err,
    });
  }
};
