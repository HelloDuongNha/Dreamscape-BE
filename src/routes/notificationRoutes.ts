import { Router } from 'express';
import {
  deleteNotification,
  getNotifications,
  markNotificationsRead,
  openNotification,
} from '../modules/social/controllers/notificationController';
import authMiddleware from '../middleware/authMiddleware';

const router = Router();

// Expose notification endpoints with auth security
router.get('/', authMiddleware, getNotifications);
router.patch('/mark-read', authMiddleware, markNotificationsRead);
router.post('/:notificationId/open', authMiddleware, openNotification);
router.delete('/:notificationId', authMiddleware, deleteNotification);

export default router;
