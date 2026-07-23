import { Router, Request, Response } from 'express';
import authRoutes         from './authRoutes';
import dreamRoutes        from './dreamRoutes';
import commentRoutes      from './commentRoutes';
import conversationRoutes from './conversationRoutes';
import notificationRoutes from './notificationRoutes';
import userRoutes         from './userRoutes';
import sourceRoutes        from './sourceRoutes';
import moderationRoutes    from './moderationRoutes';
import oracleRoutes        from './oracleRoutes';

const router = Router();


// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Returns the current server status and timestamp.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: DreamScape API is running
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 * */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'DreamScape API is running',
    timestamp: new Date().toISOString(),
  });
});

// ─── Feature Routers ──────────────────────────────────────────────────────────

router.use('/auth',          authRoutes);
router.use('/dreams',        dreamRoutes);
router.use('/comments',      commentRoutes);
router.use('/conversations', conversationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/users',         userRoutes);
router.use('/sources',       sourceRoutes);
router.use('/moderation',    moderationRoutes);
router.use('/oracle',        oracleRoutes);

export default router;
