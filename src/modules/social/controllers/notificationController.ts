import { Request, Response } from 'express';
import Notification from '../models/Notification';
import {
  deleteOwnedNotification,
  NotificationLifecycleError,
  openOwnedNotification,
} from '../services/notificationLifecycle.service';

/**
 * GET /api/notifications
 * Fetch all notifications for the logged-in user, sorted newest first.
 */
export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const myId = req.user!._id;

    const notifications = await Notification.find({ recipientId: myId })
      .sort({ timestamp: -1, _id: -1 })
      .populate('senderId', 'username display_name avatar')
      .lean();

    res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications.',
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
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read.',
    });
  }
};

export const openNotification = async (req: Request, res: Response): Promise<void> => {
  try {
    const target = await openOwnedNotification({
      notificationId: String(req.params.notificationId),
      userId: String(req.user!._id),
    });
    res.status(200).json({ success: true, data: { target } });
  } catch (error) {
    sendNotificationError(res, error, 'Failed to open notification.');
  }
};

export const deleteNotification = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteOwnedNotification({
      notificationId: String(req.params.notificationId),
      userId: String(req.user!._id),
    });
    res.status(200).json({
      success: true,
      message: 'Notification deleted.',
    });
  } catch (error) {
    sendNotificationError(res, error, 'Failed to delete notification.');
  }
};

function sendNotificationError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
): void {
  if (error instanceof NotificationLifecycleError) {
    res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }
  res.status(500).json({
    success: false,
    code: 'notification_internal_error',
    message: fallbackMessage,
  });
}
