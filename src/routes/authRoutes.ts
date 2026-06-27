import { Router } from 'express';
import { register, login, logout, updateProfile, verifyOtp, forgotPassword, resetPassword, resendOtp, getSessions, revokeSession } from '../controllers/authController';
import authMiddleware from '../middleware/authMiddleware';

const router = Router();

// ─── Swagger Component Schemas (reused across annotations) ───────────────────


/**
 * @swagger
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     UserProfile:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "665f1a2b3c4d5e6f7a8b9c0d"
 *         username:
 *           type: string
 *           example: "@helloduongnha"
 *         display_name:
 *           type: string
 *           example: "Duong Nha"
 *         email:
 *           type: string
 *           example: "duongnha@dreamscape.io"
 *         avatar:
 *           type: string
 *           example: "https://cdn.dreamscape.io/avatars/default.png"
 *         bio:
 *           type: string
 *           example: "Dreamer. Builder. Explorer."
 *         follower_count:
 *           type: number
 *           example: 0
 *         createdAt:
 *           type: string
 *           format: date-time
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *         token:
 *           type: string
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         user:
 *           $ref: '#/components/schemas/UserProfile'
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "An error occurred."
 */

// ─── POST /api/auth/register ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user account
 *     description: >
 *       Creates a new DreamScape user. The password is hashed with bcrypt
 *       before storage. Returns a signed JWT and the user's public profile.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - display_name
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 example: "@helloduongnha"
 *               display_name:
 *                 type: string
 *                 maxLength: 50
 *                 example: "Duong Nha"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "duongnha@dreamscape.io"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: "securePass123"
 *               avatar:
 *                 type: string
 *                 example: "https://cdn.dreamscape.io/avatars/default.png"
 *               bio:
 *                 type: string
 *                 maxLength: 160
 *                 example: "Dreamer. Builder. Explorer."
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       409:
 *         description: Username or email already in use
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
router.post('/register', register);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     description: >
 *       Validates user credentials. On success, returns a signed JWT (valid for
 *       7 days) and the user's public profile. The password field is never
 *       included in the response.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "duongnha@dreamscape.io"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "securePass123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid email or password
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
router.post('/login', login);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout current user
 *     description: >
 *       Stateless JWT logout. Instructs the client to discard its token.
 *       Must be called with a valid Bearer token in the Authorization header.
 *     tags:
 *       - Authentication
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
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
 *                   example: "Logged out successfully. Please discard your token on the client."
 *       401:
 *         description: Missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/logout', authMiddleware, logout);

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', authMiddleware, updateProfile);

// ─── Logged-in Devices Sessions ──────────────────────────────────────────────
router.get('/sessions', authMiddleware, getSessions);
router.delete('/sessions/:id', authMiddleware, revokeSession);

// ─── OTP Verification & Password Recovery ──────────────────────────────────────
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
