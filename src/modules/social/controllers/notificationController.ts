import { Request, Response } from 'express';
import {
  deleteOwnedNotification,
  listOwnedNotifications,
  markOwnedNotificationsRead,
  NotificationLifecycleError,
  openOwnedNotification,
} from '../services/notification/notificationLifecycle.service';

export async function getNotifications(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await listOwnedNotifications(String(req.user!._id));
    res.status(200).json({ success: true, data });
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications.',
    });
  }
}

export async function markNotificationsRead(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await markOwnedNotificationsRead(String(req.user!._id));
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
}

export async function openNotification(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const target = await openOwnedNotification({
      notificationId: String(req.params.notificationId),
      userId: String(req.user!._id),
    });
    res.status(200).json({ success: true, data: { target } });
  } catch (error) {
    sendNotificationError(res, error, 'Failed to open notification.');
  }
}

export async function deleteNotification(
  req: Request,
  res: Response,
): Promise<void> {
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
}

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
