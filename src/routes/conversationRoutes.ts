import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware';
import {
  getConversations,
  getMessages,
  searchOrCreateConversation,
  deleteConversation,
} from '../controllers/conversationController';

const router = Router();

// All chat routes are protected
router.use(authMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   - name: Conversations
 *     description: Chat conversation management and real-time messaging
 */

/**
 * @swagger
 * /api/conversations:
 *   get:
 *     summary: Get all conversations for the logged-in user
 *     description: >
 *       Returns every conversation the authenticated user participates in,
 *       populated with the partner's public profile (username, display_name,
 *       avatar) and the last_message preview. Sorted by updated_at descending.
 *     tags:
 *       - Conversations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Conversation'
 *       401:
 *         description: Unauthorized — missing or invalid JWT
 */
router.get('/', getConversations);

/**
 * @swagger
 * /api/conversations/search:
 *   post:
 *     summary: Search users and find-or-create a conversation
 *     description: >
 *       **Mode 1 (Search):** Pass only `username`. Returns up to 10 users
 *       whose username matches the query (case-insensitive prefix search).\n\n
 *       **Mode 2 (Open/Create):** Pass `username`, `targetUserId`, and
 *       `open: true`. Finds an existing conversation between the authenticated
 *       user and `targetUserId`, or creates a new one. Returns `conversationId`.
 *     tags:
 *       - Conversations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *             properties:
 *               username:
 *                 type: string
 *                 example: "@lyra"
 *               targetUserId:
 *                 type: string
 *                 example: "665f1a2b3c4d5e6f7a8b9c0d"
 *               open:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Search results or conversationId
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/UserPublic'
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     conversationId:
 *                       type: string
 *       401:
 *         description: Unauthorized
 */
router.post('/search', searchOrCreateConversation);

/**
 * @swagger
 * /api/messages/{conversationId}:
 *   get:
 *     summary: Get chat history for a conversation
 *     description: >
 *       Returns the last 50 messages for the given conversation, ordered
 *       oldest → newest (chronological). The authenticated user must be a
 *       participant of the conversation — returns 403 otherwise.
 *     tags:
 *       - Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the conversation
 *     responses:
 *       200:
 *         description: List of messages (oldest first)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *       403:
 *         description: User is not a participant in this conversation
 *       401:
 *         description: Unauthorized
 */
router.get('/messages/:conversationId', getMessages);

/**
 * @swagger
 * /api/conversations/{id}:
 *   delete:
 *     summary: Delete a conversation and all its messages
 *     description: Permanently removes the conversation and every message it contains. Only participants may delete.
 *     tags:
 *       - Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the conversation
 *     responses:
 *       200:
 *         description: Conversation deleted successfully
 *       403:
 *         description: Not a participant
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id', deleteConversation);

// ─── Swagger Schema Definitions ───────────────────────────────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *     UserPublic:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         username:
 *           type: string
 *           example: "@lyra.voss"
 *         display_name:
 *           type: string
 *           example: "Lyra Voss"
 *         avatar:
 *           type: string
 *           example: ""
 *         bio:
 *           type: string
 *           example: "Dream archivist & night wanderer."
 *
 *     Conversation:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         participant_ids:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserPublic'
 *         last_message:
 *           type: string
 *           example: "I saw you in a dream last night."
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     Message:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         conversationId:
 *           type: string
 *         senderId:
 *           $ref: '#/components/schemas/UserPublic'
 *         content:
 *           type: string
 *           example: "I saw you in a dream last night."
 *         timestamp:
 *           type: string
 *           format: date-time
 */

export default router;
