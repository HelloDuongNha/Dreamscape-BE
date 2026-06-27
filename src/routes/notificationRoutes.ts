import { Router } from 'express';
import { getNotifications, markNotificationsRead } from '../controllers/notificationController';
import authMiddleware from '../middleware/authMiddleware';

const router = Router();

// Expose notification endpoints with auth security
router.get('/', authMiddleware, getNotifications);
router.patch('/mark-read', authMiddleware, markNotificationsRead);

export default router;
