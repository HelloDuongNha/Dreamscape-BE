import { Router } from 'express';
import {
  createDream,
  getPublicFeed,
  getUserDreams,
  updateDream,
  appendDreamAddition,
  deleteDream,
  updatePrivacy,
  toggleLike,
  addComment,
  getComments,
  getDream,
  analyzeDream,
  analyzeDreamById,
  debugRag,
  saveHypothesisFeedback,
} from '../controllers/dreamController';
import authMiddleware from '../middleware/authMiddleware';

const router = Router();

// ─── Swagger Component Schema ─────────────────────────────────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *     Dream:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "665f1a2b3c4d5e6f7a8b9c0e"
 *         userId:
 *           type: string
 *           example: "665f1a2b3c4d5e6f7a8b9c0d"
 *         content:
 *           type: string
 *           example: "I was flying above a neon-lit ocean..."
 *         mood_tag:
 *           type: string
 *           example: "Lucid"
 *         is_public:
 *           type: boolean
 *           example: true
 *         likes_count:
 *           type: integer
 *           example: 0
 *         comments_count:
 *           type: integer
 *           example: 0
 *         created_at:
 *           type: string
 *           format: date-time
 *           example: "2026-05-22T00:00:00.000Z"
 *         ai_status:
 *           type: string
 *           enum: [pending, sensing, completed]
 *           example: "pending"
 *         ai_result:
 *           nullable: true
 *           type: object
 *           example: null
 *     DreamFeedResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Dream'
 *         limit:
 *           type: integer
 *           example: 10
 *         nextCursor:
 *           type: string
 *           nullable: true
 *           format: date-time
 *           description: >
 *             ISO-8601 created_at value of the last item in this page.
 *             Pass as the `nextCursor` query param in the next request to
 *             load older posts. Returns null when no further pages exist.
 *           example: "2026-05-21T18:30:00.000Z"
 */

// ─── POST /api/dreams ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams:
 *   post:
 *     summary: Create a new dream post
 *     description: >
 *       Creates a new dream and stores it in MongoDB. Requires a valid
 *       Bearer JWT. The author's userId is extracted from the token —
 *       it does not need to be sent in the request body. ai_status is
 *       automatically set to "pending".
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "I was flying above a neon-lit ocean surrounded by whales."
 *               mood_tag:
 *                 type: string
 *                 maxLength: 50
 *                 example: "Lucid"
 *               is_public:
 *                 type: boolean
 *                 default: true
 *                 example: true
 *     responses:
 *       201:
 *         description: Dream created successfully
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
 *                   example: "Dream created successfully."
 *                 data:
 *                   $ref: '#/components/schemas/Dream'
 *       400:
 *         description: Validation error — content is missing or empty
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', authMiddleware, createDream);

// ─── GET /api/dreams ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams:
 *   get:
 *     summary: Get global public dream feed (cursor-based pagination)
 *     description: >
 *       Returns a paginated list of all public dreams sorted by newest first.
 *       Uses cursor-based pagination for O(1) seek performance under large
 *       datasets — pass the `nextCursor` value from a previous response as
 *       the `nextCursor` query param to load the next page. Returns
 *       `nextCursor: null` when no further pages exist.
 *     tags:
 *       - Dreams
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of dreams to return per page.
 *       - in: query
 *         name: nextCursor
 *         schema:
 *           type: string
 *           format: date-time
 *         description: >
 *           ISO-8601 `created_at` of the last item from the previous page.
 *           Only items older than this timestamp are returned.
 *         example: "2026-05-21T18:30:00.000Z"
 *     responses:
 *       200:
 *         description: Paginated list of public dreams
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DreamFeedResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', getPublicFeed);

// ─── GET /api/dreams/user/:userId ─────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/user/{userId}:
 *   get:
 *     summary: Get a user's personal dream archive (cursor-based pagination)
 *     description: >
 *       Returns all dreams (public and private) for the specified user,
 *       sorted newest first. Uses the same cursor-based pagination as the
 *       global feed. Intended for the Profile page archive view (FR05).
 *     tags:
 *       - Dreams
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the target user.
 *         example: "665f1a2b3c4d5e6f7a8b9c0d"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of dreams to return per page.
 *       - in: query
 *         name: nextCursor
 *         schema:
 *           type: string
 *           format: date-time
 *         description: >
 *           ISO-8601 `created_at` of the last item from the previous page.
 *           Only items older than this timestamp are returned.
 *         example: "2026-05-21T18:30:00.000Z"
 *     responses:
 *       200:
 *         description: Paginated list of the user's dreams
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DreamFeedResponse'
 *       400:
 *         description: Invalid userId format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/user/:userId', getUserDreams);

// ─── PUT /api/dreams/:id ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}:
 *   put:
 *     summary: Edit a dream post
 *     description: >
 *       Updates the content of a dream. Only the owner can edit.
 *       The old content is automatically archived in edit_history before saving.
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the dream
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Dream updated successfully
 *       400:
 *         description: Missing or invalid content
 *       403:
 *         description: Not the owner or not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:id', authMiddleware, updateDream);
router.post('/:id/additions', authMiddleware, appendDreamAddition);

// ─── DELETE /api/dreams/:id ───────────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}:
 *   delete:
 *     summary: Delete a dream post
 *     description: Permanently removes the dream document. Only the owner can delete.
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the dream
 *     responses:
 *       200:
 *         description: Dream deleted successfully
 *       403:
 *         description: Not the owner or not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id', authMiddleware, deleteDream);

// ─── PATCH /api/dreams/:id/privacy ───────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}/privacy:
 *   patch:
 *     summary: Update privacy setting of a dream
 *     description: >
 *       Sets the dream's privacy field to 'public' or 'private'.
 *       Also syncs is_public accordingly. Only the owner can change it.
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the dream
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [privacy]
 *             properties:
 *               privacy:
 *                 type: string
 *                 enum: [public, private]
 *     responses:
 *       200:
 *         description: Privacy updated successfully
 *       400:
 *         description: Invalid privacy value
 *       403:
 *         description: Not the owner or not found
 *       401:
 *         description: Unauthorized
 */
router.patch('/:id/privacy', authMiddleware, updatePrivacy);

// ─── POST /api/dreams/:id/like ───────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}/like:
 *   post:
 *     summary: Toggle like on a dream
 *     description: >
 *       If the authenticated user has already liked the dream, this removes the like.
 *       Otherwise it adds a like. Returns the new likes_count, likes array, and liked boolean.
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Like toggled successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Dream not found
 */
router.post('/:id/like', authMiddleware, toggleLike);

// ─── POST /api/dreams/:id/comments ───────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}/comments:
 *   post:
 *     summary: Add a comment to a dream
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       201:
 *         description: Comment created
 *       400:
 *         description: Missing content or invalid dreamId
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Dream not found
 */
router.post('/:id/comments', authMiddleware, addComment);

// ─── GET /api/dreams/:id/comments ────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/{id}/comments:
 *   get:
 *     summary: Get all comments for a dream
 *     description: Returns comments sorted chronologically (oldest first) with userId populated.
 *     tags:
 *       - Dreams
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Comments fetched successfully
 *       400:
 *         description: Invalid dreamId
 */
router.get('/:id/comments', getComments);
router.get('/:id', authMiddleware, getDream);

// ─── POST /api/dreams/analyze ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/analyze:
 *   post:
 *     summary: Analyze a user dream post via the RAG pipeline and local Ollama instance
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dreamText
 *             properties:
 *               dreamText:
 *                 type: string
 *                 maxLength: 2000
 *                 example: "I dreamed about swimming in a warm, clean pool of water under the moon."
 *               sleepContext:
 *                 type: object
 *                 example: { "position": "supine", "temperature": "hot" }
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 default: private
 *                 example: "private"
 *     responses:
 *       201:
 *         description: Dream analyzed and saved successfully
 *       400:
 *         description: Validation error
 *       502:
 *         description: Bad Gateway (Ollama invalid response or schema mismatch)
 *       503:
 *         description: Service Unavailable (Ollama connection error or timeout)
 */
router.post('/analyze', authMiddleware, analyzeDream);
router.post('/:id/analyze', authMiddleware, analyzeDreamById);
router.post('/:id/hypothesis-feedback', authMiddleware, saveHypothesisFeedback);

// ─── POST /api/dreams/debug-rag ──────────────────────────────────────────────

/**
 * @swagger
 * /api/dreams/debug-rag:
 *   post:
 *     summary: Test symbol retrieval via the Hybrid RAG Search strategy (No LLM generation)
 *     tags:
 *       - Dreams
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dreamText
 *             properties:
 *               dreamText:
 *                 type: string
 *                 maxLength: 2000
 *                 example: "I had a vivid dream where I was falling from a high building."
 *     responses:
 *       200:
 *         description: Successfully retrieved top matching symbols
 *       400:
 *         description: Validation error
 */
router.post('/debug-rag', authMiddleware, debugRag);

export default router;
