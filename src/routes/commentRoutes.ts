import { Router } from 'express';
import { getUserComments } from '../modules/social/controllers/commentController';
import {
  deleteComment,
  editComment,
} from '../modules/dream/controllers/dreamComment.controller';
import authMiddleware, { optionalAuthMiddleware } from '../middleware/authMiddleware';

const router = Router();

// ─── GET /api/comments/user/:userId ──────────────────────────────────────────

/**
 * @swagger
 * /api/comments/user/{userId}:
 *   get:
 *     summary: Get all comments made by a specific user
 *     description: >
 *       Returns all comments authored by the given userId, sorted newest-first.
 *       The dreamId field is fully populated (including the dream's author) so
 *       the client can render the original post inside ReplyCard without
 *       a second request.
 *     tags:
 *       - Comments
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the target user
 *     responses:
 *       200:
 *         description: Comments fetched successfully
 *       400:
 *         description: Invalid userId format
 *       500:
 *         description: Internal server error
 */
router.get('/user/:userId', optionalAuthMiddleware, getUserComments);
router.patch('/:commentId', authMiddleware, editComment);
router.delete('/:commentId', authMiddleware, deleteComment);

export default router;
