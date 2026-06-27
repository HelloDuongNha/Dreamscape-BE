import { Router } from 'express';
import { getUserProfile, toggleFollow, getStreakCalendar, trackHeartbeat } from '../controllers/userController';
import authMiddleware from '../middleware/authMiddleware';

const router = Router();

/**
 * @swagger
 * /api/users/me/heartbeat:
 *   post:
 *     summary: Send heartbeat to update user active time online
 *     description: Tracks screen-time securely using the server's time truth.
 *     tags:
 *       - Users
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Heartbeat recorded successfully
 *       401:
 *         description: Unauthorized
 */
router.post('/me/heartbeat', authMiddleware, trackHeartbeat);

/**
 * @swagger
 * /api/users/me/streak-calendar:
 *   get:
 *     summary: Get current user's streak & rank calendar data
 *     description: Returns loginHistory, streakCount, rankPoints, and currentRank for the authenticated user.
 *     tags:
 *       - Users
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Streak calendar data fetched successfully
 *       401:
 *         description: Unauthorized
 */
// NOTE: /me/streak-calendar MUST be declared before /:id to avoid 'me' being parsed as an ObjectId
router.get('/me/streak-calendar', authMiddleware, getStreakCalendar);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a user's public profile details
 *     description: Returns public details, follower/following count, and connections.
 *     tags:
 *       - Users
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user.
 *     responses:
 *       200:
 *         description: User profile fetched successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: User not found
 */
router.get('/:id', authMiddleware, getUserProfile);

/**
 * @swagger
 * /api/users/{id}/follow:
 *   post:
 *     summary: Follow or unfollow a user
 *     description: Toggles following connection for the logged-in user.
 *     tags:
 *       - Users
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the target user.
 *     responses:
 *       200:
 *         description: Follow connection toggled successfully
 *       400:
 *         description: Cannot follow yourself or invalid ID format
 *       404:
 *         description: User not found
 */
router.post('/:id/follow', authMiddleware, toggleFollow);

export default router;

