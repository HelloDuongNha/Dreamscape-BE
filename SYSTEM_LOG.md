# DreamScape Backend — SYSTEM LOG

> Last Updated: 2026-05-22 (STEP 5 Completed)
> Maintained manually as the project grows.

---

## Project Status

| Item | Status |
|------|--------|
| Node.js + Express server | ✅ Scaffolded |
| TypeScript configuration | ✅ Configured (`tsconfig.json`) |
| Folder structure | ✅ Created |
| MongoDB (Mongoose) connection | ✅ Active — `mongodb://localhost:27017/dreamscape` |
| Swagger / OpenAPI 3.0 docs | ✅ Rendering at `http://localhost:5001/api-docs` — 10 paths detected |
| Environment variables (dotenv) | ✅ `.env` + `.env.example` present |
| Security middleware (helmet, cors) | ✅ Integrated — CSP/COEP disabled in dev for Swagger |
| HTTP logging (morgan + custom) | ✅ Integrated |
| Error handling middleware | ✅ Integrated |
| Health-check route (`GET /api/health`) | ✅ Ready |
| **STEP 2 — User Authentication** | ✅ **Completed** |
| User model (`src/models/User.ts`) | ✅ Created — unique indexes on `username` + `email` (no duplicates) |
| bcrypt password hashing (pre-save hook) | ✅ Active — saltRounds: 12 |
| JWT signing & verification | ✅ Active — `JWT_EXPIRES_IN=7d` |
| `POST /api/auth/register` | ✅ Implemented |
| `POST /api/auth/login` | ✅ Implemented |
| `POST /api/auth/logout` | ✅ Implemented |
| `authMiddleware.ts` (JWT guard) | ✅ Created |
| Swagger annotations for auth routes | ✅ Documented at `/api-docs` |
| **STEP 3 — Dream CRUD + Pagination** | ✅ **Completed** |
| Dream model (`src/models/Dream.ts`) | ✅ Created — §6.2 compliant, compound + standalone indexes |
| `POST /api/dreams` | ✅ Implemented — protected (JWT required) |
| `GET /api/dreams` | ✅ Implemented — public feed, cursor-based pagination |
| `GET /api/dreams/user/:userId` | ✅ Implemented — profile archive, cursor-based pagination |
| Swagger annotations for dream routes | ✅ Documented — DreamFeedResponse + Dream schemas |
| **STEP 5 — Real-time Chat Backend** | ✅ **Completed** |
| Conversation model (`src/models/Conversation.ts`) | ✅ Created — §6.3 compliant, multikey + updated_at indexes |
| Message model (`src/models/Message.ts`) | ✅ Created — §6.4 compliant, compound `{conversationId, timestamp}` index |
| `GET /api/conversations` | ✅ Implemented — protected, returns partner profile + last_message |
| `GET /api/conversations/messages/:id` | ✅ Implemented — protected, participant guard, last 50 msgs |
| `POST /api/conversations/search` | ✅ Implemented — user search + find-or-create conversation |
| `src/config/socket.ts` | ✅ Socket.io layer with JWT handshake middleware |
| `server.ts` | ✅ Upgraded — `http.Server` wrapping Express, Socket.io attached |
| TypeScript compilation | ✅ 0 errors |

---

## Folder Structure

```
BE/
├── src/
│   ├── config/
│   │   ├── db.ts            # Mongoose connection
│   │   └── swagger.ts       # swagger-jsdoc options & spec
│   ├── controllers/
│   │   └── authController.ts  # register / login / logout handlers
│   ├── middleware/
│   │   ├── authMiddleware.ts  # JWT Bearer token guard
│   │   ├── errorHandler.ts    # Global Express error handler
│   │   └── requestLogger.ts   # Per-request timing logger
│   ├── models/
│   │   └── User.ts            # Mongoose schema (FR01 / §6.1)
│   ├── routes/
│   │   ├── authRoutes.ts      # Auth endpoints + Swagger JSDoc
│   │   └── index.ts           # Base router (health + mounts)
│   ├── app.ts               # Express app (middleware, routes)
│   └── server.ts            # Entry point (DB connect → listen)
├── .env                     # Local env vars (git-ignored)
├── .env.example             # Env template (committed)
├── .gitignore
├── package.json
├── tsconfig.json
└── SYSTEM_LOG.md            # This file
```

---

## MongoDB Setup Status

| Setting | Value |
|---------|-------|
| ODM | Mongoose 9 |
| **Active connection string** | `mongodb://localhost:27017/dreamscape` |
| URI env key | `MONGODB_URI` (in `.env`) |
| Connection file | `src/config/db.ts` |
| Connection timing | Called in `server.ts` **before** `app.listen()` |
| On failure behavior | Logs error → `process.exit(1)` |
| Indexes | `username: 1` and `email: 1` (on `users` collection) |

To connect to MongoDB Atlas, replace `MONGODB_URI` in `.env`:
```
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/dreamscape
```

---

## Environment Variables

```dotenv
PORT=5001
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/dreamscape
JWT_SECRET=your_super_secret_key_k9_term8
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
```

---

## npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `nodemon --watch src --ext ts --exec ts-node src/server.ts` | Start dev server with hot-reload |
| `npm run build` | `tsc` | Compile TypeScript → `dist/` |
| `npm start` | `node dist/server.js` | Run compiled production build |
| `npm run typecheck` | `tsc --noEmit` | Type-check — **currently 0 errors** ✅ |

---

## API Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | None | Server health check |
| `GET` | `/api-docs` | None | Swagger UI |

### Authentication (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | None | Create new user account |
| `POST` | `/api/auth/login` | None | Authenticate and receive JWT |
| `POST` | `/api/auth/logout` | Bearer JWT | Stateless logout |

---

## Auth Payload Schemas

### `POST /api/auth/register`

**Request Body:**
```json
{
  "username": "@helloduongnha",
  "display_name": "Duong Nha",
  "email": "duongnha@dreamscape.io",
  "password": "securePass123",
  "avatar": "https://cdn.dreamscape.io/avatars/default.png",
  "bio": "Dreamer. Builder. Explorer."
}
```
> `avatar` and `bio` are optional.

**Success Response `201`:**
```json
{
  "success": true,
  "message": "Account created successfully.",
  "token": "eyJhbGci...",
  "user": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "username": "@helloduongnha",
    "display_name": "Duong Nha",
    "email": "duongnha@dreamscape.io",
    "avatar": "",
    "bio": "",
    "follower_count": 0,
    "createdAt": "2026-05-22T00:00:00.000Z"
  }
}
```

**Error Response `409` (duplicate username/email):**
```json
{
  "success": false,
  "message": "An account with this email already exists."
}
```

---

### `POST /api/auth/login`

**Request Body:**
```json
{
  "email": "duongnha@dreamscape.io",
  "password": "securePass123"
}
```

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Login successful.",
  "token": "eyJhbGci...",
  "user": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0d",
    "username": "@helloduongnha",
    "display_name": "Duong Nha",
    "email": "duongnha@dreamscape.io",
    "avatar": "",
    "bio": "",
    "follower_count": 0,
    "createdAt": "2026-05-22T00:00:00.000Z"
  }
}
```

**Error Response `401`:**
```json
{
  "success": false,
  "message": "Invalid email or password."
}
```

---

### `POST /api/auth/logout`

**Headers required:** `Authorization: Bearer <token>`

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Logged out successfully. Please discard your token on the client."
}
```

---

## Installed Dependencies

### Runtime (`dependencies`)

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `mongoose` | MongoDB ODM |
| `dotenv` | Load `.env` into `process.env` |
| `cors` | Cross-Origin Resource Sharing headers |
| `helmet` | Secure HTTP response headers |
| `morgan` | HTTP request logger (dev) |
| `swagger-ui-express` | Serve Swagger UI at `/api-docs` |
| `swagger-jsdoc` | Generate OpenAPI spec from JSDoc comments |
| `bcryptjs` | Password hashing (saltRounds: 12) |
| `jsonwebtoken` | JWT signing and verification |

### Development (`devDependencies`)

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `ts-node` | Run TypeScript directly (dev only) |
| `nodemon` | File watcher / auto-restart |
| `@types/express` | Express type declarations |
| `@types/node` | Node.js type declarations |
| `@types/cors` | CORS type declarations |
| `@types/morgan` | Morgan type declarations |
| `@types/swagger-ui-express` | Swagger UI type declarations |
| `@types/swagger-jsdoc` | swagger-jsdoc type declarations |
| `@types/bcryptjs` | bcryptjs type declarations |
| `@types/jsonwebtoken` | jsonwebtoken type declarations |

---

## Next Steps

- Add Dream model (`src/models/Dream.ts`) and CRUD endpoints
- Add Conversation + Message models for the Messenger feature
- Add input validation middleware (e.g., `zod` or `express-validator`)
- Add profile endpoints (`GET /api/users/:username`)
- Implement token refresh or Redis blacklist for production-grade logout

---

## Hotfix: Swagger Configuration & Index Cleanup

> Applied: 2026-05-22

### Bug 1 — Swagger UI Blank Page ✅ Fixed

**Root Cause:** `helmet()` was enabled with its default `contentSecurityPolicy` (CSP) directive, which blocks all inline scripts and styles. `swagger-ui-express` injects inline `<script>` and `<style>` tags to bootstrap the Swagger UI — these were silently blocked by the browser, producing a completely blank page with no visible error.

**Fix applied in** `src/app.ts`:
```typescript
// Before (CSP blocks swagger-ui inline assets → blank page)
app.use(helmet());

// After (CSP explicitly allows inline scripts/styles for Swagger)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc:  ["'self'", "'unsafe-inline'"],
        imgSrc:    ["'self'", 'data:', 'https:'],
        connectSrc:["'self'"],
      },
    },
  }),
);
```

**Verification:** Reloading `http://localhost:5000/api-docs` now fully renders `POST /api/auth/register`, `POST /api/auth/login`, and `POST /api/auth/logout` with complete request/response schemas.

---

### Bug 2 — Swagger glob path hardened ✅ Fixed

**Root Cause:** `./src/routes/*.ts` relies on `process.cwd()` being the `BE/` directory. Using `path.join(__dirname, ...)` in `src/config/swagger.ts` makes paths absolute and unambiguous regardless of invocation directory.

**Fix applied in** `src/config/swagger.ts`:
```typescript
apis: [
  path.join(__dirname, '../routes/*.ts'),
  path.join(__dirname, '../controllers/*.ts'),
],
```

---

### Bug 3 — Duplicate MongoDB Indexes ✅ Fixed

**Root Cause:** `unique: true` inside a Mongoose field definition **automatically creates a unique index** for that field. The code also had explicit `UserSchema.index({ username: 1 })` and `UserSchema.index({ email: 1 })` calls below the schema, causing Mongoose to register each index twice — triggering the duplicate index warning on every server start.

**Fix applied in** `src/models/User.ts`:
```typescript
// REMOVED — these were duplicates of the indexes created by unique: true
UserSchema.index({ username: 1 }); // ← deleted
UserSchema.index({ email: 1 });    // ← deleted
```

The `unique: true` declarations on `username` and `email` still enforce uniqueness. Zero Mongoose warnings on restart.

---

## Hotfix: Resolved 403 Forbidden on Swagger UI

> Applied: 2026-05-22

### Root Cause — macOS AirPlay Receiver Port Conflict ✅ Fixed

**Root Cause:** `HTTP 403 Forbidden` responses were NOT coming from Express. Every curl response contained `Server: AirTunes/935.7.1` — macOS **AirPlay Receiver** (Control Center) is a system-level service that permanently occupies port **5000** on macOS Ventura and later. Express also tried to bind to 5000, but AirPlay's listener answered inbound connections first.

**Proof (from curl `-sv` output):**
```
< HTTP/1.1 403 Forbidden
< Server: AirTunes/935.7.1       ← macOS AirPlay, NOT Express
< X-Apple-ProcessingTime: 0
```

**Debug confirmation (Swagger spec was always correct):**
```
=== SWAGGER DEBUG ===
Scanned paths:
 • /Users/.../DreamScape/BE/src/routes/*.ts
 • /Users/.../DreamScape/BE/src/models/*.ts
Paths detected: [ '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/health' ]
```

**Fix applied:** Changed `PORT=5000` → `PORT=5001` in `.env`. Port 5001 is free.

**Additional fixes applied in this session:**
- `src/config/swagger.ts`: Changed `path.join(__dirname, ...)` → `path.join(process.cwd(), ...)` for reliable glob resolution
- `src/app.ts`: Moved Swagger mount **before** `helmet()` and disabled `contentSecurityPolicy: false, crossOriginEmbedderPolicy: false` in dev
- `src/app.ts`: Restored `customSiteTitle`, `customCss`, and `persistAuthorization` options

**Verification:**
```
🚀 DreamScape API running on port 5001
📖 Swagger Docs → http://localhost:5001/api-docs   ← HTTP 200 ✅
🩺 Health Check → http://localhost:5001/api/health ← HTTP 200 ✅
```

> **Alternative fix (not applied):** Disable AirPlay Receiver via System Settings → General → AirDrop & Handoff → AirPlay Receiver → OFF. This would free port 5000.

---

## STEP 3 — Dream CRUD with Cursor-Based Pagination ✅

> Completed: 2026-05-22

### New Files Created

| File | Role |
|------|------|
| `src/models/Dream.ts` | Mongoose schema — §6.2 compliant |
| `src/controllers/dreamController.ts` | createDream, getPublicFeed, getUserDreams |
| `src/routes/dreamRoutes.ts` | Route definitions + full Swagger JSDoc |

`src/routes/index.ts` updated: `router.use('/dreams', dreamRoutes)` added.

---

### Dream Model — `src/models/Dream.ts` (§6.2)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `_id` | ObjectId | auto | MongoDB document id |
| `userId` | ObjectId | required | ref → `User` collection |
| `content` | string | required | 1–2000 chars |
| `mood_tag` | string | `""` | e.g. "Lucid", "Nightmare", "Calm" |
| `is_public` | boolean | `true` | false = private (not in global feed) |
| `likes_count` | number | `0` | min 0 |
| `comments_count` | number | `0` | min 0 |
| `created_at` | Date | `new Date()` | **explicit field — used as pagination cursor** |
| `ai_status` | enum | `"pending"` | `pending \| sensing \| completed` |
| `ai_result` | Mixed \| null | `null` | Phase 2 Oracle payload placeholder |

#### Indexes

```typescript
// Compound — covers personal timeline + userId lookups
DreamSchema.index({ userId: 1, created_at: -1 });

// Standalone — covers global feed sorted by newest
DreamSchema.index({ created_at: -1 });
```

> `created_at` is an explicit Date field (not Mongoose `timestamps`) so it can
> be used directly as a `$lt` cursor in queries. MongoDB will use the index
> for both equality and range filters.

---

### API Endpoints — Dreams

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/dreams` | Bearer JWT | Create a new dream |
| `GET` | `/api/dreams` | None | Public feed (cursor-paginated) |
| `GET` | `/api/dreams/user/:userId` | None | User's personal archive (cursor-paginated) |

---

### `POST /api/dreams` — Create Dream

**Request Body:**
```json
{
  "content": "I was flying above a neon-lit ocean surrounded by whales.",
  "mood_tag": "Lucid",
  "is_public": true
}
```
> `mood_tag` and `is_public` are optional. `content` is required.
> `userId` is extracted from the JWT — never sent by the client.

**Success Response `201`:**
```json
{
  "success": true,
  "message": "Dream created successfully.",
  "data": {
    "_id": "665f1a2b3c4d5e6f7a8b9c0e",
    "userId": "665f1a2b3c4d5e6f7a8b9c0d",
    "content": "I was flying above a neon-lit ocean surrounded by whales.",
    "mood_tag": "Lucid",
    "is_public": true,
    "likes_count": 0,
    "comments_count": 0,
    "created_at": "2026-05-22T00:00:00.000Z",
    "ai_status": "pending",
    "ai_result": null
  }
}
```

---

### `GET /api/dreams` — Global Public Feed

**Query Params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | `10` | Max items per page (max 100) |
| `nextCursor` | ISO-8601 string | — | `created_at` of last seen item |

**Cursor-Based Pagination Mechanics:**

1. **First page** (no cursor): `db.dreams.find({ is_public: true }).sort({ created_at: -1 }).limit(10)`
2. **Next page**: `db.dreams.find({ is_public: true, created_at: { $lt: <cursor> } }).sort({ created_at: -1 }).limit(10)`
3. **Last page**: `nextCursor` is `null` — no further items.

> **Why cursor-based?** `skip()` forces MongoDB to scan all preceding documents
> regardless of index. At N=100,000 posts, a `skip(90000)` scan takes O(N) time.
> Cursor pagination seeks directly to the cursor position using the `created_at`
> index in O(log N) time — performance stays constant regardless of collection size.

**Success Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "665f...",
      "userId": { "username": "@helloduongnha", "display_name": "Duong Nha", "avatar": "" },
      "content": "Flying above a neon ocean...",
      "mood_tag": "Lucid",
      "is_public": true,
      "likes_count": 0,
      "comments_count": 0,
      "created_at": "2026-05-22T00:00:00.000Z",
      "ai_status": "pending",
      "ai_result": null
    }
  ],
  "limit": 10,
  "nextCursor": "2026-05-21T18:30:00.000Z"
}
```
> `nextCursor` is the `created_at` of the **last** item in `data`. Pass it as
> `?nextCursor=<value>` in the next request. Returns `null` on the last page.

---

### `GET /api/dreams/user/:userId` — Personal Archive

Same response shape as the global feed. Returns all dreams (public + private)
for the specified user. Intended for the Profile page archive (FR05).

---

### Next Steps (STEP 4)

- Comment model + endpoints (`POST /api/dreams/:id/comments`)
- Input validation middleware (Zod)
- Profile endpoints (`GET /api/users/:username`)

---

## STEP 5 — Real-time Chat Backend ✅

> Completed: 2026-05-22

### New Files

| File | Role |
|------|------|
| `src/models/Conversation.ts` | Mongoose schema — §6.3 compliant |
| `src/models/Message.ts` | Mongoose schema — §6.4 compliant |
| `src/controllers/conversationController.ts` | getConversations, getMessages, searchOrCreateConversation |
| `src/routes/conversationRoutes.ts` | 3 HTTP routes + full Swagger JSDoc |
| `src/config/socket.ts` | Socket.io init, JWT handshake, event handlers |

`src/server.ts` upgraded to `http.createServer(app)` pattern.
`src/routes/index.ts` updated: `router.use('/conversations', conversationRoutes)` added.

---

### Conversation Model — `src/models/Conversation.ts` (§6.3)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `_id` | ObjectId | auto | MongoDB document id |
| `participant_ids` | ObjectId[] | required | Exactly 2 user refs. Validated length=2. |
| `last_message` | string | `""` | Preview text for conversation list |
| `updated_at` | Date | `new Date()` | Explicit field — used for recency sort |
| `created_at` | Date | auto | Via Mongoose `timestamps` alias |

**Indexes:**
```typescript
ConversationSchema.index({ participant_ids: 1 }); // multikey — covers user's conv list
ConversationSchema.index({ updated_at: -1 });      // sort by recency
```

---

### Message Model — `src/models/Message.ts` (§6.4)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `_id` | ObjectId | auto | MongoDB document id |
| `conversationId` | ObjectId | required | FK → Conversation |
| `senderId` | ObjectId | required | FK → User |
| `content` | string | required | 1–2000 chars |
| `timestamp` | Date | `new Date()` | Explicit field — used for chronological sort |

**Index:**
```typescript
MessageSchema.index({ conversationId: 1, timestamp: 1 }); // compound — lookup + sort in one scan
```

---

### HTTP Endpoints — Conversations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/conversations` | 🔒 JWT | All conversations for the logged-in user |
| `GET` | `/api/conversations/messages/:conversationId` | 🔒 JWT + participant check | Last 50 messages, oldest first |
| `POST` | `/api/conversations/search` | 🔒 JWT | Search users + find-or-create conversation |

#### `GET /api/conversations` — Response
```json
{
  "success": true,
  "data": [
    {
      "_id": "665f...",
      "participant_ids": [
        { "_id": "...", "username": "@me", "display_name": "Me", "avatar": "", "bio": "" },
        { "_id": "...", "username": "@lyra.voss", "display_name": "Lyra Voss", "avatar": "", "bio": "..." }
      ],
      "last_message": "I saw you in a dream last night.",
      "updated_at": "2026-05-22T01:00:00.000Z"
    }
  ]
}
```

#### `POST /api/conversations/search` — Request
```json
// Mode 1: Search users
{ "username": "@lyra" }

// Mode 2: Open or create conversation
{ "username": "@lyra", "targetUserId": "665f...", "open": true }
```

---

### Socket.io Real-time Events

#### Connection
- **Transport:** WebSockets (`ws://localhost:5001`), polling fallback.
- **Auth:** JWT must be passed in `socket.handshake.auth.token` (or `Authorization` header).
- **On connect:** Socket auto-joins a **private room** named after `userId`.

#### Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `join_room` | `{ conversationId: string }` | Client enters a conversation view; server joins socket to `conv:<id>` |
| `send_message` | `{ conversationId: string, content: string }` | Client sends a message |

#### Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `receive_message` | `{ _id, conversationId, senderId, content, timestamp }` | Delivered to **recipient's private room** AND confirmed back to sender |
| `error_message` | `{ message: string }` | Emitted to sender on validation/auth failure |

#### `send_message` Server Logic
1. Validate `conversationId` (ObjectId format) and `content` (non-empty).
2. Verify sender is a participant via `Conversation.findOne({ participant_ids: userId })`.
3. Persist `Message` to MongoDB.
4. Update `Conversation.last_message` + `updated_at`.
5. Emit `receive_message` to the **recipient's private userId room**.
6. Emit `receive_message` back to the **sender's socket** (instant confirm).

#### JWT Handshake Middleware
```typescript
// Client connection (example)
const socket = io('http://localhost:5001', {
  auth: { token: localStorage.getItem('ds_token') }
});
```
Sockets without a valid JWT are rejected at the middleware level before any event handler runs.

---

### Next Steps (STEP 6)

- Frontend: Wire `socket.io-client` into `useMessagesStore.ts`
- Comment model + endpoints (`POST /api/dreams/:id/comments`)
- Input validation middleware (Zod)
- Profile endpoints (`GET /api/users/:username`)

---

## STEP 6 — Bug Fixes & Message Delivery Receipts ✅

> Completed: 2026-05-22

### Bug 1 — Clicking Search Result Did Not Open Chat ✅ Fixed

**Root Cause:** `conversationController.ts → searchOrCreateConversation` validated `username` as required
before checking the `open=true + targetUserId` path. When the frontend called
`openConversationWithUser(userId)` it sent `{ username: '', targetUserId, open: true }` —
the controller responded `400 username is required` before reaching the find-or-create logic.

**Fix in** `src/controllers/conversationController.ts`:
- Mode 2 (`open && targetUserId`) is now checked **first**, before any username validation.
- Mode 1 (search) validation remains intact for username-only requests.

---

### Bug 2 — Fake Hardcoded Badge Count ✅ Fixed

**Root Cause:** `AppSidebar.vue` had `badge: 3` hardcoded in the static `navItems` array.

**Fix:**
- `useChatStore` now exposes `totalUnread: computed<number>` — the sum of `unreadCounts` map values.
- `unreadCounts[conversationId]` is incremented when `receive_message` arrives for a **non-active** conversation from another user.
- Opening a conversation resets (`delete`) its unread count.
- `AppSidebar.vue` `navItems` converted to `computed()` so `badge` reactively binds to `chatStore.totalUnread`.

---

### Task 3 — Message Delivery Status (Sent / Delivered / Seen) ✅ Implemented

#### Database

`src/models/Message.ts` — added `status` field:
```typescript
status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' }
```

#### Socket Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `message_delivered` | `{ messageId: string }` | Emitted by recipient as soon as `receive_message` fires |
| `mark_as_seen` | `{ conversationId: string }` | Emitted when recipient opens or is viewing the conversation |

#### Socket Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `receive_message` | `{ ..., status: 'sent' }` | Now includes `status` field |
| `message_status_updated` | `{ messageId?, conversationId?, status }` | Sent to the original sender when status changes |

#### Server Logic (`src/config/socket.ts`)

- **`message_delivered`**: Updates `Message.status` to `'delivered'` in MongoDB. Emits `message_status_updated` to the original sender's private room.
- **`mark_as_seen`**: Bulk-updates all unread partner messages in the conversation to `'seen'`. Emits `message_status_updated` (with `conversationId`) to the partner.

#### Frontend Logic (`src/store/useChatStore.ts`)

- `receive_message` handler: recipient auto-emits `message_delivered` immediately on receipt.
  If recipient is already viewing the conversation, also emits `mark_as_seen`.
- `message_status_updated` handler: updates `msg.status` in the local `messages` array reactively.
- Opening a conversation (`openConversation`) emits `mark_as_seen` so any unread messages are marked seen.

#### UI (`src/features/messages/ChatWindow.vue`)

- `isLastSentMsg(msg)` — detects if this is the last message sent by the current user.
- `statusLabel(status)` — returns `'Sent'`, `'Delivered'`, or `'Seen'`.
- Status text is displayed below the **last outgoing message only** in muted gray (`font-size: 10px`, `opacity: 0.8`).

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 7 — Chat Sync Hardening & Conversation Menu ✅

> Completed: 2026-05-22

### Task 1 — Duplicate Message Fix via Client-Side Temp ID ✅

**Problem:** When the sender's socket receives the server echo of `receive_message`, the `already` check compared against `payload._id` (the real MongoDB ObjectId). Since the optimistic entry had `_id: 'optimistic-...'`, no match was found and a duplicate bubble appeared.

**Fix:**

**Backend (`src/config/socket.ts`):**
- `SendMessagePayload` now accepts an optional `tempId: string`.
- On persist, two payloads are constructed: `recipientPayload` (no tempId) and `senderPayload` (`{ ...recipientPayload, tempId }`).
- Recipient receives a clean payload; sender receives the payload with `tempId`.

**Frontend (`src/store/useChatStore.ts`):**
- `sendMessage()` generates `tempId = 'temp-' + Date.now()` and passes it in the socket emit.
- Optimistic message `_id` is set to `tempId` (prefix changed from `optimistic-` to `temp-`).
- `receive_message` handler: if `payload.tempId` exists, find the entry with `_id === tempId` and **replace in-place**. Returns early — no duplicate push.

**Frontend (`src/features/messages/ChatWindow.vue`):**
- Optimistic CSS class check updated to `msg._id.startsWith('temp-')`.

Socket payload (sender echo):
```json
{
  "_id": "<real-mongodb-id>",
  "conversationId": "...",
  "senderId": "...",
  "content": "Hello",
  "timestamp": "2026-05-22T...",
  "status": "sent",
  "tempId": "temp-1716340800000"
}
```

---

### Task 2 — Strict Seen/Delivered Logic ✅

**Problem:** `mark_as_seen` was being emitted by the recipient even when they were viewing a different conversation.

**Fix (`src/store/useChatStore.ts`):**
```typescript
// STRICT: only emit mark_as_seen when activeConversationId === payload.conversationId
if (!isFromMe && isActiveConv) {
  socket?.emit('mark_as_seen', { conversationId: payload.conversationId })
}
```

`openConversation()` also emits `mark_as_seen` immediately when a conversation is opened, so previously-received unread messages are bulk-marked as seen.

---

### Task 3 — Global Sidebar Socket Listener ✅

**Problem:** Socket listener was only active while the MessagesView was mounted. Badge didn't update when user was on Home/Oracle.

**Fix (`src/App.vue`):**
`useAuthStore()` is instantiated at the root component level. The auth store constructor calls `_connectChat()` if a token is in localStorage, which calls `connectSocket()` on the chat store. The global socket listener is now alive from app boot, regardless of which route is active.

---

### Task 4 — Flat Conversation Action Menu ✅

**New: `DELETE /api/conversations/:id` (Backend)**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `DELETE` | `/api/conversations/:id` | 🔒 JWT + participant | Hard-deletes conversation + all messages |

Server response `200`:
```json
{ "success": true, "message": "Conversation deleted." }
```

**New: 3-dot menu (`src/features/messages/ChatWindow.vue`)**

- `⋮` button in the chat header (32×32px, flat, no border)
- Dropdown panel: `background: #181818`, `border: 1px solid #262626`, no `box-shadow`, no `backdrop-filter`
- **Mute Notifications** — toggles `mutedConversations[convId]` in Pinia. When muted, incoming messages do NOT increment `unreadCounts`. Badge label switches between `'Mute notifications'` / `'Unmute notifications'` with a `'Muted'` badge pill.
- **Delete Conversation** — calls `chatStore.deleteConversation(convId)` → `DELETE /api/conversations/:id` → clears local `conversations`, `messages`, `unreadCounts`, and resets `activeConversationId = null`.
- Menu closes on: outside click, route change, or post-action.

**New store state/actions:**
```typescript
mutedConversations: Record<string, boolean>  // state
isActiveMuted: computed<boolean>             // getter
toggleMute(convId: string): void             // action
deleteConversation(convId: string): Promise  // action
```

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 8 — Per-Conversation Unread Counts ✅

> Completed: 2026-05-22

### Task 1 — Backend: `unread_count` in GET /api/conversations ✅

**File:** `src/controllers/conversationController.ts` → `getConversations`

After fetching the conversations list, a `Promise.all` computes `unread_count` for each conversation in parallel:

```typescript
const unread_count = await Message.countDocuments({
  conversationId: conv._id,
  senderId:       { $ne: myId },   // messages from the partner
  status:         { $ne: 'seen' }, // not yet seen by me
})
```

Each conversation object in the response now includes `unread_count: number`.

**Type:** `ApiConversation.unread_count: number` added to `src/api/types.ts`.

---

### Task 2 — Frontend Store: Reactive `unread_count` on `conversations[]` ✅

**File:** `src/store/useChatStore.ts`

The `totalUnread` computed now uses the spec-mandated formula:
```typescript
const totalUnread = computed(() =>
  conversations.value.reduce((sum, c) => sum + (c.unread_count || 0), 0)
)
```

**On `receive_message` (non-active conversation):**
```typescript
const targetConv = _findConv(payload.conversationId)
if (targetConv && !mutedConversations.value[payload.conversationId]) {
  targetConv.unread_count = (targetConv.unread_count || 0) + 1
}
```
Writing directly to `targetConv.unread_count` triggers Vue's reactivity — `totalUnread` and the badge update instantly.

**On `openConversation(convId)`:**
```typescript
const conv = _findConv(convId)
if (conv) conv.unread_count = 0          // instant UI reset
socket?.emit('mark_as_seen', { conversationId: convId }) // persist to MongoDB
```
The frontend resets to 0 immediately (no flicker), and the backend bulk-updates all partner messages to `status: 'seen'` so the count stays 0 on refresh.

---

### Task 3 — UI: Flat Badge in ConversationList ✅

**File:** `src/features/messages/ConversationList.vue`

Each conversation row conditionally renders a flat badge:
```html
<span v-if="item.conversation.unread_count > 0" class="conv-list__unread-badge">
  {{ item.conversation.unread_count > 9 ? '9+' : item.conversation.unread_count }}
</span>
<span v-else class="conv-list__item-time">{{ timeAgo(...) }}</span>
```

**Badge CSS (strictly flat):**
```css
.conv-list__unread-badge {
  background: #3B82F6;   /* solid flat blue — no gradient */
  color: #ffffff;
  border-radius: 9px;    /* pill */
  min-width: 18px;
  height: 18px;
  font-size: 10px;
  font-weight: bold;
  box-shadow: none;      /* no shadow */
  /* no backdrop-filter, no blur */
}
```

Additional UX: snippet text gets `color: var(--color-text-secondary)` + `font-weight: medium` when `unread_count > 0`, making the unread row visually distinct.

---

### Task 4 — Verification Scenario ✅

| Scenario | Behaviour |
|----------|-----------|
| User A has 2 unread from Conv1, User B has 3 unread from Conv2 | Conv1 badge shows `2`, Conv2 badge shows `3` |
| Global sidebar Messages icon | Shows `5` (2 + 3) via `totalUnread` computed |
| User opens Conv1 | Badge instantly disappears from Conv1, global badge drops to `3` |
| Backend `mark_as_seen` | All Conv1 messages updated to `status: 'seen'` in MongoDB |
| Page refresh | Server recomputes `unread_count: 0` for Conv1 → badge stays gone |
| Muted conversation | Incoming messages do NOT increment `unread_count` |

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```
```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 9 — Global Notification Sync & Route State Fixes ✅

> Completed: 2026-05-22

### Root Cause Analysis

Two structural bugs prevented reliable real-time notification delivery:

| Bug | Root Cause |
|-----|------------|
| **Badges blank on refresh** | `loadConversations()` was only called inside `MessagesView.vue`'s `onMounted`. Until the user explicitly visited `/messages`, the `conversations[]` array was empty and `totalUnread` always returned `0`. |
| **Ghost "seen" bug** | `activeConversationId` was never reset when navigating away from `/messages`. If the user left the Messages tab while Conversation A was open, any incoming message from Conversation A would pass the `isActiveConv` check, emit `mark_as_seen`, and set `status = 'seen'` — bypassing `unread_count` increments entirely. |

---

### Task 1 — Global Conversation Prefetch in `App.vue` ✅

**File:** `src/App.vue`

```typescript
onMounted(async () => {
  if (authStore.isLoggedIn) {
    await chatStore.loadConversations()
  }
})
```

`loadConversations()` now runs once at app boot, before any route renders. The `conversations[].unread_count` values from the server are immediately available to `totalUnread`, so the sidebar badge is populated on every route — including Home, Oracle, and after hard page refresh.

**`MessagesView.vue` cleanup:** The duplicate `loadConversations()` call was removed. The view now reuses `chatStore.isLoadingConvs` for skeleton display instead of its own local `isLoading` ref. The `userId` query param watcher is consolidated into a single `watch(..., { immediate: true })`, replacing the previous `onMounted + watch` pair.

---

### Task 2 — Route Guard: Clear Active Conversation on Leave ✅

**File:** `src/router/index.ts` (new `afterEach` hook)

```typescript
router.afterEach((to, from) => {
  const wasOnMessages = from.name === 'messages'
  const nowOnMessages = to.name === 'messages'

  if (wasOnMessages && !nowOnMessages) {
    import('@/store/useChatStore').then(({ useChatStore }) => {
      useChatStore().clearActiveConversation()
    })
  }
})
```

**New store action:** `clearActiveConversation()` in `useChatStore.ts`
```typescript
function clearActiveConversation(): void {
  activeConversationId.value = null
}
```

**Effect on the strict seen condition:**
```
After guard fires:
  activeConversationId = null

Incoming socket message on Home Feed:
  isActiveConv = (payload.conversationId === null) → false
  → mark_as_seen NOT emitted
  → message_delivered IS emitted (user is online)
  → targetConv.unread_count += 1
  → totalUnread computed updates
  → Sidebar badge increments in real-time ✅
```

Lazy `import()` is used inside the guard to avoid a circular module dependency at router init time (router → store → router would deadlock).

---

### Task 3 — Socket Lifecycle Verification ✅

The global `receive_message` socket listener in `useChatStore.connectSocket()` handles all routes correctly:

| User location | `activeConversationId` | `isActiveConv` | mark_as_seen? | unread_count? |
|---------------|----------------------|----------------|---------------|---------------|
| On `/messages`, Conversation A open | `convA._id` | `true` (for A) | ✅ emitted | stays 0 |
| On `/messages`, different conv open | `convB._id` | `false` (for A) | ❌ | += 1 ✅ |
| On `/home`, `/oracle`, `/settings` | `null` | always `false` | ❌ | += 1 ✅ |
| After logout | socket disconnected | N/A | N/A | N/A |

No code duplicates — `loadConversations()` is called exactly once (App.vue), `connectSocket()` is idempotent, and `clearActiveConversation()` is the single source of truth for resetting route-level chat state.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 10 — Post Management (Edit, Delete, Privacy) ✅

> Completed: 2026-05-22

### Task 1 — Reusable Global UI Components ✅

#### `AppDropdown.vue` (`src/components/common/AppDropdown.vue`)
- Accepts `options: DropdownItem[]` — each item may be a `DropdownOption` (label, value, icon, badge, danger, disabled) or a `{ divider: true }` separator
- Named `trigger` slot — the parent provides any button/element that calls `toggle()`
- Click-outside listener via `document.addEventListener('click', ...)` — unmounted in `onUnmounted`
- Flat panel: `background: #181818`, `border: 1px solid #262626`, `box-shadow: none`, `backdrop-filter: none`
- Smooth `opacity + translateY` fade transition (0.1s)

#### `AppConfirm.vue` (`src/components/common/AppConfirm.vue`)
- `v-model` (Boolean) — controls visibility
- Props: `title`, `message`, `confirmLabel`, `cancelLabel`, `danger` (red button), `loading` (disables buttons)
- Emits: `confirm`, `cancel`, `update:modelValue`
- `Teleport to="body"` — avoids z-index stacking issues with card overflow
- Overlay: `rgba(0, 0, 0, 0.8)`, no blur; panel: `#181818`, `1px solid #262626`, no shadow

---

### Task 2 — Backend Schema & Routes ✅

#### `src/models/Dream.ts`
```typescript
privacy:      { type: String, enum: ['public', 'private'], default: 'public' }
edit_history: [{ content: String, editedAt: { type: Date, default: Date.now } }]
```
Sub-schema `EditHistorySchema` with `_id: false`. `IDream` interface updated with both fields.

#### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PUT` | `/api/dreams/:id` | 🔒 owner | Push old content → `edit_history`, update `content` |
| `DELETE` | `/api/dreams/:id` | 🔒 owner | Hard-delete the document |
| `PATCH` | `/api/dreams/:id/privacy` | 🔒 owner | Set `privacy` ('public'/'private'), sync `is_public` |

All three use `findOne({ _id, userId: myId })` ownership check before mutating.

---

### Task 3 — Frontend Integration ✅

#### `src/api/types.ts`
- `ApiDream` updated: added `privacy: 'public' | 'private'` and `edit_history: { content: string; editedAt: string }[]`
- Added `UpdateDreamResponse` interface

#### `src/store/useDreamStore.ts`
- `editDream(id, content)` → `PUT /api/dreams/:id` → in-place swap in `dreams[]`
- `removeDream(id)` → `DELETE /api/dreams/:id` → filter from `dreams[]`
- `changePrivacy(id, privacy)` → `PATCH /api/dreams/:id/privacy` → in-place update

#### `src/features/home/DreamCard.vue`
- **3-dot button** (`.dream-card__menu-btn`) — only visible when `isOwner` (`authStore.myId === dream.userId._id`)
- Opens **AppDropdown** with: Edit Post, Make Public/Private (dynamic label), divider, Delete (danger)
- **Inline edit mode** — textarea with character counter, Save/Cancel buttons, `isSaving` state
- **Delete** — triggers AppConfirm modal with `danger=true`; only calls `removeDream()` after confirmation
- **"Edited" badge** — displayed when `dream.edit_history.length > 0`
- `overflow: visible` on `.dream-card` so the dropdown panel can escape the card bounds

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 11 — Interaction System (Likes, Comments, Post Detail Modal) ✅

> Completed: 2026-05-22

### Task 1 — Backend: Likes & Comments APIs ✅

**New model:** `src/models/Comment.ts` — fields: dreamId, userId, content, created_at. Compound index {dreamId:1, created_at:1}.

**Dream.ts:** Added `likes: [String]` array + `likes: string[]` to IDream interface.

**New controllers:** `toggleLike` (POST /:id/like), `addComment` (POST /:id/comments), `getComments` (GET /:id/comments) — all with ownership/existence checks and Swagger docs.

### Task 2 — Frontend: Like Sync & LIKES Tab ✅

**types.ts:** Added `likes: string[]` to ApiDream. New: `LikeResponse`, `ApiComment`, `CommentListResponse`.

**useDreamStore.ts:** `toggleLike()` → POST API → in-place likes[]+likes_count update. `incrementCommentCount()` for comment sync. `getLikedDreams(myUserId)` for LIKES tab.

**DreamCard.vue:** `isLiked` computed from `dream.likes.includes(myId)`. Like button: filled #EF4444 heart + `.dream-card__action--liked` class. `handleLike()` calls store directly, no emit needed.

**ProfileView.vue:** LIKES tab wired to `dreamStore.getLikedDreams(authStore.myId)`. Hidden for other users. Renders DreamCard per liked dream. PostDetailModal included.

### Task 3 — Post Detail Modal ✅

`usePostStore.ts:` Removed all mock data. `openPost()` fetches real comments. `addComment()` calls POST API. `focusedUser` from populated dream.userId.

`PostDetailModal.vue:` Real like button (#EF4444 filled heart). Real comments with populated author info + RouterLink. Async submit with isSubmitting guard. Loading state.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## STEP 13 — Real-Time Notification System & Profile/Account Validation ✅

> Completed: 2026-05-22

### Task 1 — Backend: Notification Model, Real-Time Socket Logic & Endpoints ✅

- **Model:** Created Mongoose notification schema in `src/models/Notification.ts` with fields `recipientId`, `senderId`, `type` (`like` | `comment`), `postId`, `isRead` (default `false`), and `timestamp` (default `Date.now`). Added compound index `{ recipientId: 1, timestamp: -1 }`.
- **Live Trigger Logic:** Integrated notification creation in `toggleLike` and `addComment` within `src/controllers/dreamController.ts`. If the trigger user is not the owner, it creates a database notification and emits a `new_notification` socket event to the owner's private room.
- **Endpoints:** Implemented `GET /api/notifications` (fetching notifications, sorted by timestamp descending, populated with sender user details) and `PATCH /api/notifications/mark-read` (marking notifications as read) in `src/controllers/notificationController.ts` and `src/routes/notificationRoutes.ts`.
- **Single Dream GET Endpoint:** Registered `GET /api/dreams/:id` to retrieve a single dream. This allows the global `PostDetailModal` (now in `MainLayout.vue`) to load and display dreams directly from a notification click.

### Task 2 — Frontend: Notification Store & Global Layout Integration ✅

- **Store:** Built `useNotificationStore.ts` with getters for `unreadCount` and actions to fetch notifications, mark them as read, and listen to incoming sockets.
- **Visual Bell Menu:** Refactored `MainLayout.vue` to add a dynamic notification bell in the global toolbar. Displays a red notification dot if `unreadCount > 0`. Opens a dropdown showing all notifications.
- **Detail Modal Teleportation:** Teleported `PostDetailModal` to the layout root level in `MainLayout.vue`, resolving duplicate layout structures and allowing modal opens directly from notifications.

### Task 3 — Profile & Settings Form Validations ✅

- **Profile Update PUT API:** Implemented a unified `PUT /api/auth/profile` in the backend (`authController.ts`) supporting display name, handle (username), bio, email, and password changes, with uniqueness checks and server validation.
- **Profile Header Edit Modal:** Lock handle input visually behind a locked `@` symbol prefix and enforce frontend length checks and character validation.
- **Settings Account & Security Polish:** Updated both forms in `SettingsAccount.vue` and `SettingsSecurity.vue` to hit the real `PUT /api/auth/profile` endpoint, rendering server-returned `400` validation or `409` conflict error text (`#EF4444`) under their respective fields and syncing user state dynamically.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Feature Deprecation: Completely removed post classification tags from BE and FE for UI optimization

> Completed: 2026-05-26

### Task 1 — Backend Database & Route Cleanup ✅

- **Model:** Opened `src/models/Dream.ts`. Completely removed `tags: [String]` field definition, constant `DREAM_TAGS`, and `DreamTag` export type.
- **Controllers:** Opened `src/controllers/dreamController.ts`. Cleaned up `createDream` handler to stop parsing, validating, and saving the `tags` array payload.

### Task 2 — Frontend UI & Store Cleanup ✅

- **API Types & Store:** Removed `tags` field from the `ApiDream` interface in `src/api/types.ts` and `useDreamStore.ts`. Removed `DREAM_TAGS` and `DreamTag` exports. Adjusted store action `addDream` signature and request body to exclude `tags`.
- **Composer Component (`HomeView.vue`):** Removed the inline tag selector row/buttons from the HTML template. Cleaned up `selectedTags` state ref, `toggleTag` helper, and reset code on submit. Updated search `filteredDreams` computed property to no longer filter by `dream.tags`. Deleted all CSS classes for `.composer__tags` and `.composer__tag`.
- **Card Component (`DreamCard.vue`):** Removed tag badge rendering section (`.dream-card__tags`) from the HTML. Removed computed property `dreamTags` and all associated style rules from the CSS sheet.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 13A: Hardened Profile Fields Validation & Timeline Layout Polish

> Completed: 2026-05-26

### Task 1 — Complete Tag Purge & Profile Layout Spacing ✅

- **Tag Purge:** Double-checked and confirmed that all tag badges, templates, bindings, and references (including the `dream.tags` text search filter query) are completely purged from frontend and backend files.
- **Profile Layout Spacing:** Added a vertical spacing gap `gap: var(--space-4)` (equivalent to `16px`) in `src/features/profile/ProfileView.vue` for the `.profile-feed` container. User's archived dreams are now separated nicely instead of clumping together.

### Task 2 — Hardened Validation UI with Locked Handle Prefix ✅

- **Locked Handle `@` prefix:** Hardcoded the `@` symbol before the username edit input in both `ProfileHeader.vue` and `SettingsAccount.vue`. It is rendered visually as a prefix that cannot be typed, selected, deleted, or cleared by backspacing.
- **Strict JavaScript Validations:** Enforced watchers on both forms (`ProfileHeader.vue` and `SettingsAccount.vue`) that dynamically sanitize username inputs to reject/strip whitespaces or special characters instantly. Form validations strictly block saving if display name or handle is empty/whitespaces-only, showing a flat, sharp red error message under the field.

### Task 3 — Backend API Validation Sync ✅

- **Empty payload rejection:** Modified the update profile controller (`updateProfile` in `BE/src/controllers/authController.ts`) to intercept profile updates. If the request payload contains no valid mutable properties, the endpoint immediately returns `400 Bad Request` with message `'Update payload cannot be empty.'`.
- **Constraint check:** Synchronized the handle constraints to reject special characters (only `[a-zA-Z0-9_]` allowed after the `@`) and return `409 Conflict` if the name or email changes collide with an existing database user.

TypeScript: 0 errors (BE) | 0 errors (FE)

---

## Step 13B: Google SMTP OTP Verification & Global Toast Integration

**Date:** 2026-05-26  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Folder & Architecture Setup (Decoupled Layers)

- **OTP Model (`BE/src/models/Otp.ts`):** Stores temporary OTP records. Contains a Mongoose TTL index that auto-expires records after 5 minutes (300 seconds).
- **Email Template (`BE/src/templates/otpTemplate.ts`):** Renders a strictly flat HTML template (background `#101010`, border `1px solid #262626` container, white text, and monospace code).
- **Email Service (`BE/src/services/emailService.ts`):** Decoupled SMTP service layer using `nodemailer`. Initializes a secure pool connection on port 465 (`smtp.gmail.com`). Gracefully catches and logs transport failures to prevent crashing the server with 500 errors.
- **Global Toast Notification System (`FE/src/App.vue` & `useSettingsStore`):** Teleported the toast component markup and micro-animations to the root `App.vue`. Leverages Pinia's `useSettingsStore` to show flat toasts globally.

---

### Global Toast Actions Wired

Toast messages are dynamically triggered on the following events:
- **Registration Completed:** Triggered immediately after successful OTP verification (`OtpVerifyView.vue`).
- **Logout Success:** Triggered right after session cleanup in `authStore.logout()`.
- **Post Created Successfully:** Triggered immediately after unshifting a new dream into the feed in `dreamStore.addDream()`.
- **Settings Updated:** Triggered after committing display name, username, bio, email, or password modifications.

---

### API Schemas & Endpoints

#### 1. Registration (`POST /api/auth/register`)
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "status": "pending",
    "email": "smtp_tester_user@dreamscape.io",
    "message": "Verification OTP sent to your email. Please verify to complete registration."
  }
  ```

#### 2. OTP Verification (`POST /api/auth/verify-otp`)
- **Request Body:**
  ```json
  {
    "email": "smtp_tester_user@dreamscape.io",
    "otpCode": "620629",
    "purpose": "register"
  }
  ```
- **Success Response (`201 Created` / `200 OK`):**
  ```json
  {
    "success": true,
    "message": "Account verified and created successfully.",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "6a14a345eec36788cf2b9ee0",
      "username": "@smtp_tester",
      "display_name": "SMTP Tester",
      "email": "smtp_tester_user@dreamscape.io",
      "follower_count": 0,
      "createdAt": "2026-05-25T19:30:13.835Z"
    }
  }
  ```

#### 3. Resend OTP (`POST /api/auth/resend-otp`)
- **Request Body:**
  ```json
  {
    "email": "smtp_tester_user@dreamscape.io",
    "purpose": "register"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "A new verification code has been sent to your email."
  }
  ```

#### 4. Forgot Password (`POST /api/auth/forgot-password`)
- **Request Body:**
  ```json
  {
    "email": "smtp_tester_user@dreamscape.io"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "If the email matches an active account, a password reset code has been sent."
  }
  ```

#### 5. Reset Password (`POST /api/auth/reset-password`)
- **Request Body:**
  ```json
  {
    "email": "smtp_tester_user@dreamscape.io",
    "otpCode": "723168",
    "newPassword": "newpassword456"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "message": "Password reset successfully. You can now log in with your new password."
  }
  ```

---

### Verification Summary

- **TypeScript Compilation:** Passed with **0 compile errors** for both stacks (`npm run typecheck` equivalent).
- **Google SMTP Delivery:** Verified via local SMTP runner. Emails are accepted and routed by Google SMTP with response status code `250 2.0.0 OK`.
- **Global Toast Verification:** Confirmed that toast elements slide down from top center on all routes and fade out gracefully after 3.5 seconds.

---

## Step 13C: Fluid Collapsible Left Sidebar Animation

**Date:** 2026-05-26  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Isolate and Fix Icon Axis Container

- **Permanent Alignment:** Refactored the sidebar to ensure that all navigation menu items, logo icon, profile and settings links, and collapse chevron keep their icon containers permanently sized at `40px` width and height.
- **Fixed Padding:** Kept the parent sidebar horizontal padding constant at `10px` in both expanded and collapsed states. This mathematically locks the center of every icon at exactly `30px` from the left edge of the viewport in both states, preventing any horizontal movement or shift.

### Task 2 — Smooth Text Label and Gap Transition

- **Reactive State Bindings:** Removed Vue transitions and instead used CSS class bindings (`:class`) to transition label, badge, and logo text properties (`opacity`, `max-width`, `margin`, `padding`) smoothly using `cubic-bezier(0.4, 0, 0.2, 1)` and `ease`.
- **Flex Gap Transitions:** Transitioned the `gap` property on navigation items and logo elements from `var(--space-3)` (12px) to `0` when collapsing to prevent width overflow or layout jumps.

### Task 3 — Parent Sidebar Width & Layout Synchrony

- **Synchronized Transitions:** Styled the sidebar's `width` and `padding` to transition smoothly in `0.3s` using the `cubic-bezier(0.4, 0, 0.2, 1)` standard easing.
- **Main Layout Synchronization:** Synchronized the margin offset (`margin-left`) of the main content wrapper (`.main-layout__body` in `MainLayout.vue`) to transition using the exact same `0.3s cubic-bezier(0.4, 0, 0.2, 1)` function, eliminating lag or stutter.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 14 - Part 1: Comprehensive Follow System and Account Privacy Configurations

**Date:** 2026-05-26  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Backend Follow Model & API Routes

- **Mongoose User Schema Update (`BE/src/models/User.ts`):**
  Added `followers: [String]` and `following: [String]` arrays, which store the UUIDs of users connected to each profile.
- **Toggle Follow API Endpoint (`POST /api/users/:id/follow`):**
  Implemented a protected route that handles both follow and unfollow toggling:
  - Updates arrays `followers` and `following` on the target user and the current user documents.
  - Updates `follower_count` in Mongoose and returns the sanitized target user profile.
- **Fetch Profile API Endpoint (`GET /api/users/:id`):**
  Added a protected endpoint to retrieve public profile parameters of any user by their MongoDB ObjectId, allowing the profile viewer to render details before loading the dreams feed.

### Task 2 — Settings Privacy Schema

- **Mongoose Schema Integration:**
  Updated the User model with functional privacy options:
  - `isPrivateAccount: { type: Boolean, default: false }`
  - `dmPrivacy: { type: String, enum: ['everyone', 'following', 'friends'], default: 'everyone' }`
- **Dynamic Configuration Updates:**
  Wired the new settings parameters to the user profile update route (`PUT /api/auth/profile`), persisting changes to MongoDB and propagating updates to the frontend auth state.
- **Direct Message Filters:**
  Enhanced `searchOrCreateConversation` in `BE/src/controllers/conversationController.ts` to enforce `dmPrivacy` filters for newly initiated direct chats. Initiating a chat returns `403 Forbidden` if the initiator does not satisfy the privacy conditions (e.g. mutual friends, or followed by target).

### Task 3 — Frontend Settings UI & Follow Integration

- **Privacy Settings Pane (`FE/src/features/settings/SettingsPrivacy.vue`):**
  Built flat UI toggles with no shadows or gradients matching the threads-style minimal dark theme:
  - Added a checkbox switch for 'Protect your Account' (`isPrivateAccount`).
  - Added a dropdown selector for 'Who can send you direct messages' (`dmPrivacy`).
- **Profile Connection Header (`FE/src/features/profile/ProfileHeader.vue`):**
  - Displays Followers and Following count columns side-by-side inside the stats row.
  - Renders a prominent flat action button (either solid "Follow" or outline "Following") that fires follow API requests.
- **Private Feed Gatekeeper (`FE/src/features/profile/ProfileView.vue`):**
  - Profile feed fetches user details via `/api/users/:userId`.
  - Blocks the feed display and renders a beautiful flat message stating `"This Account is Private"` if the user is private and the viewer is not in their followers array.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 14 - Part 2: Select Components, Live Notifications, and Followers Modal

**Date:** 2026-05-26  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Decoupled Reusable Select & Switch Toggle Fix

- **AppSelect.vue Component:** Extracted the flat dropdown menu into a highly reusable component in `FE/src/components/common/AppSelect.vue`. Positioned the custom down-arrow chevron with equal `12px` right padding, balanced perfectly against the `36px` right text padding.
- **Switch Click Target Bug Fix:** Replaced `div.flat-switch` with `label.flat-switch` wrapper inside `SettingsPrivacy.vue`, correcting sibling click event propagation and ensuring the account protection slider operates reactively.

### Task 2 — Real-time Follow Notifications

- **Trigger Logic (`BE/src/controllers/userController.ts`):** Updates the follow controller so that following a user generates a Mongoose `Notification` document of type `'follow'` (with `postId` set as optional) and emits a `new_notification` socket.io event to the recipient's private room.
- **Bell Dropdown Layout (`FE/src/layouts/MainLayout.vue`):** Integrates follow notifications into the Heading Toolbar Bell layout ('User A followed you'). Clicking a notification marks it as read and redirects the user directly to the follower's profile page (`/profile/:id`).

### Task 3 — Instagram-style Followers/Following Modal

- **Interactive Stats Rows (`FE/src/features/profile/ProfileHeader.vue`):** Converted followers and following stats counters into styled clickable buttons that trigger tabs inside the FollowersModal.
- **Centralized Tabbed Modal (`FE/src/features/profile/FollowersModal.vue`):** Renders a popup modal over a dark overlay (`rgba(0, 0, 0, 0.8)`) with followers/following tabs, flat avatars, display names, and profile router links. Uses list lengths and database counts to dynamically enforce privacy rules if viewing restrictions apply.

### Task 4 — New View Visibility Settings

- **User Model updates (`BE/src/models/User.ts`):** Exposes `followersPrivacy` and `followingPrivacy` configurations (`'everyone' | 'following' | 'only_me'`), saving them directly on profile updates.
- **Privacy Page Options (`FE/src/features/settings/SettingsPrivacy.vue`):** Embedded two new `AppSelect` inputs for choosing followers and following lists view permissions, syncing preference changes instantly with backend updates.

### Task 5 — Twitter-style Account Creation Date

- **Joined Date label (`FE/src/features/profile/ProfileHeader.vue`):** Fetches the authentic `createdAt` timestamp from the database and renders a muted `"📅 Joined Month Year"` subtitle below the bio in `ProfileHeader.vue`.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2: Dynamic Profile Streak Flames, No-Scroll Calendar Layout, and Daily Rank Quest System

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Dynamic Profile Streak Flame
- **Minimalist Flame overlay (`ProfileHeader.vue`):** Renders a flat, custom SVG flame icon overlaid absolute on the top-right of the user's avatar. Displays the user's `streakCount` text in white in the center of the flame.
- **Dynamic Solid Colors:**
  - 1–3 days: Matte Orange (`#F97316`)
  - 4–7 days: Crimson Red (`#EF4444`)
  - 8–14 days: Deep Purple (`#A855F7`)
  - 15+ days: Cyber Cyan/Blue (`#06B6D4`)
  - Streak of 0: Flame is hidden.

### Task 2 — No-Scroll Split Calendar Dashboard
- **Layout Dimensions:**
  - Container locked to `height: calc(100vh - var(--header-height) - 48px)` with `overflow: hidden`.
  - Split: Left Column (`3/5` width) for Streak/Check-in stats & Month/Grid; Right Column (`2/5` width) for Rank progression & Daily quests.
- **Visuals:** Entire layout fits on screen without scrollbars, maintaining standard desktop viewport margins.

### Task 3 — Redesign Rank Progression UI
- **Flat Progress Track:** Solid track (`#262626`) with green fill (`#10B981`) and score ratio (e.g. `36/100`) aligned upper right.
- **Tiers Timeline:** Connected vertically below the progress track using thin, flat `1px` lines (`#262626`) with circles indicating tiers. Emojis completely removed.

### Task 4 — Daily Tasks Quest System
- **Mongoose User Schema Integration:** Added `dailyTasks` tracking completion of three specific actions reset every calendar day:
  1. `likeOtherPost`: Liking another user's dream (+20 points).
  2. `commentOtherPost`: Commenting on another user's dream (+20 points).
  3. `createPost`: Posting 1 new dream of own (+20 points).
- **Backend controllers:** Handled in `dreamController.ts` within `createDream`, `toggleLike`, and `addComment` using `completeDailyTask` utility. Point updates trigger dynamic rank re-evaluation via `rankEngine`.
- **Frontend Checklist:** Displayed in right column. Tasks mark as completed with low-contrast line-through text or pending with a clean 1px square border.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 16: Server-Time Security Hardening, Tiered Achievements System, Screen-Time Tracker, and Global Avatar Synchronization

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Secure Time Tracking Truth (Anti-Cheat)
- **Time Truth Implementation:** Decoupled check-in highlights, month navigator, and streak resets from client browser's clock. The application strictly defaults to the backend server's `serverDate` ('YYYY-MM-DD') retrieved dynamically.
- **Anti-Cheat Validation:** Client machine timestamp changes have no effect on login records or active day calculations.

### Task 2 — Progressive Milestones & Achievements
- **Quests Deprecation:** Completely removed the Daily Quests card checklist to reduce spam actions on the feed.
- **Milestone Achievements:** Implemented two continuous milestone stages with progressive thresholds:
  - **Thần Mơ Tích Lũy** (Likes Received): Stage 1 (100 likes $\rightarrow$ +20 rankPoints); Stage 2 (500 likes $\rightarrow$ +50 rankPoints).
  - **Tri Kỷ Sâu Sắc** (Comments Received): Stage 1 (50 comments $\rightarrow$ +20 rankPoints); Stage 2 (200 comments $\rightarrow$ +50 rankPoints).
  - Progress bars: styled in flat blue (`#3B82F6`) on a dark track (`#262626`) showing active ratios.
- **End-Game Calibration:** Capped the ultimate rank ('Kẻ Thao Túng Giấc Mơ') behind requirements:
  - Streak count of at least 30 consecutive server-days.
  - Stage 2 of both "Thần Mơ Tích Lũy" and "Tri Kỷ Sâu Sắc" achievements.
  - User score over 2000 points.

### Task 3 — Screen-Time Session Tracker & Muted Health Warning
- **Online Stats Card:** Added a 3rd stats card titled `'Time Online Today'` showing accumulated minutes spent active.
- **Warning Tag:** Renders the amber flat warning block (`border: 1px solid #78350F; color: #D97706; background: rgba(120, 53, 15, 0.05)`) recommending screen limits.
- **Heartbeat Ping Endpoint (`POST /api/users/me/heartbeat`):** Heartbeat tracks active sessions. Prevents spam pings from cheating the timer by requiring a minimum 45-second duration gap between increments.

### Task 4 — Global Avatar Synchronization
- **Initials Avatar Sync:** Integrated initials avatar color picker logic into the Sticky Top Header avatar button by binding `:style="{ background: avatarBg }"`, ensuring it reactively updates and matches the initials color scheme of posts and profile timeline.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 17: Gamification Upgrades, TFT-Style Streak Interest, Reusable Progress System, and Profile Badge

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — TFT-Style Login Interest Formula & Streak History (Anti-Inflation)
- **TFT Login Interest:** Implemented the anti-inflation streak interest formula:
  $$\text{Interest} = \min\left(\left\lfloor \frac{\text{streakCount}}{10} \right\rfloor, 5\right)$$
- **Points Formula:** Points rewarded on daily login = `10 (base) + baseStageMax + Interest`.
- **Stage Rewards:** Capped at exactly 6 stages: Stage 1 (+0), Stage 2 (+2), Stage 3 (+5), Stage 4 (+10), Stage 5 (+15), Stage 6 (+20). Max points achievable on Day 365 is 35 points.
- **Kỷ nguyên gắn kết:** Added the `highestStreak` property to the User model, tracking highest consecutive login streak and checking milestones: `10d -> +20`, `30d -> +50`, `90d -> +100`, `180d -> +200`, `270d -> +350`, `365d -> +500` rankPoints.

### Task 2 — 6 Rank Tiers & Sync 6 Milestone Colors
- **Expanded Tiers:** Expanded the rank calculation engine in `rankEngine.ts` and the UI to support exactly 6 ranks:
  - Rank 1: `Nhà Mơ Mộng Mới` (0 - 100 pts) -> Bronze Brown (`#B45309`)
  - Rank 2: `Người Bắt Đầu Mơ` (101 - 500 pts) -> Silver Gray (`#94A3B8`)
  - Rank 3: `Bậc Thầy Giải Mã` (501 - 2000 pts) -> Gold Yellow (`#F59E0B`)
  - Rank 4: `Kẻ Thao Túng Giấc Mơ` (2001 - 5000 pts) -> Platinum Cyan (`#06B6D4`)
  - Rank 5: `Độc Hành Tinh Không` (5001 - 15000 pts) -> Diamond Purple (`#A855F7`)
  - Rank 6: `Đấng Sáng Tạo Thực Tại` (15001+ pts) -> Crimson Red (`#EF4444`)
- **Ultimate Rank Gating:** Calibrated the new highest rank (`Đấng Sáng Tạo Thực Tại`) to require `streakCount >= 30` (or `highestStreak >= 30`) + Stage 2 achievements (`likes_100` and `comments_100`). Gating requirements are removed from Rank 4.
- **Dynamic Color Scheme:** Main Rank Progression bar dynamically utilizes the solid active color matching the user's current rank tier.

### Task 3 — CSS Shiny Autoloading Rank Badge
- **Badge Tag:** Integrated a high-end flat Rank Badge text tag directly beneath the biography text in `ProfileHeader.vue`.
- **Shiny Sweep effect:** Applied a flat white low-opacity overlay (`rgba(255,255,255,0.15)`) skewed at `-25deg` sliding across the badge every 3.5 seconds using pure CSS custom keyframe animation (no gradients/blur).
- **Emoji Purge:** Removed the calendar icon `📅` from `Joined` to ensure 0 emojis rule.

### Task 4 — Clean Reusable Progress System
- **AppProgressBar.vue:** Created a reusable progress bar supporting both continuous progress and a 6-segment battery style layout. Used for the main rank progression and all 3 achievements rows in `CalendarView.vue`.
- **Consolidated Milestone Rows:** Replaced achievements list with exactly 3 dynamic rows ('Tổng lượt thích nhận được', 'Tổng bình luận nhận được', 'Kỷ nguyên gắn kết') where target transitions dynamically on completion (10 -> 100 -> 1,000 -> 10,000 -> 100,000 -> 1,000,000) and displays clear rewards (e.g. `[+20 pts on completion]`).
- **Warning prose:** Replaced health warning with a small, low-contrast prose text block sitting directly beneath the online timer card (removed emojis and background containers).

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2A: Fixed-Axis Hardening for Calendar Grid Cells

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Lock Absolute Dimensions for Calendar Cells
- **Strict Dimensions:** Locked `.calendar-grid__cell` dimensions to exactly `width: 40px` and `height: 40px` with `box-sizing: border-box`.
- **Anti-Resizing:** Removed relative scaling and dynamic sizing properties (`flex-1`, percentage sizes) to prevent browser auto-resizing.

### Task 2 — Fixed Starting Position & Grid Coordinates
- **Uniform Rows:** Replaced fractional rows inside `.calendar-grid` with a rigid grid template: `grid-template-rows: 24px repeat(6, 40px)`.
- **Zero Jitter:** Months with 5 weeks keep the 6th row empty and transparent at the bottom, reserving layout space silently to prevent vertical expansion and month-transition jumps.

### Task 3 — Whitespace Gap Purging
- **Spacing Tightening:** Tightened the space between the weekday headers and the first week of date cells by reducing weekday headers padding to `0`, setting a rigid `height: 24px`, and aligning with a matching `line-height`.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 17B: Calendar Fluid Grid Expansion and Equalized Metrics Overhaul

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Fluid Calendar Grid Expansion
- **Stretched Width:** Removed hardcoded `40px` grid column sizing and replaced it with a fluid layout: `grid-template-columns: repeat(7, 1fr)`. The calendar grid now stretches fully across the horizontal space of the left 3/5 column, aligning Saturday (SAT) flush with the right column.
- **Proportional Cell Sizing:** Configured grid cell boxes to adjust fluidly using `width: 100%` and a strict 1:1 aspect ratio (`aspect-ratio: 1 / 1`), scaling them up cleanly without leaving vertical or horizontal empty slots.

### Task 2 — Locked 42-Cell Monthly Grid
- **Trailing Placeholders:** Appended trailing empty cells (`42 - startPadding - daysInMonth`) to the calendar grid loop so that exactly 42 cell items (6 full weeks) are rendered at all times.
- **Stationary Layout:** With exactly 42 elements inside the grid and `grid-template-rows: 24px repeat(6, 1fr)`, transitioning between months has 0 vertical displacement, 0 scaling jitter, and keeps Week 1 permanently stationary.

### Task 3 — Equalized Metrics & Global Warning Footer
- **Height Equalization:** Extracted the warning text container entirely out of the 'Time Online Today' card. All 3 metrics cards are now styled identically using `.stat-card` inside the stats row, aligning their padding and height.
- **Global Footer:** Placed the low-contrast warning prose text collectively beneath all 3 stats cards as a clean section footer.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2B: Visual Sizing, Zoom Elasticity, and Monday-Start Calendar Grid Mappings

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Cell Sizing and Viewport Height Elasticity
- **Responsive Constraints:** Applied viewport height based constraints to the grid cells: `width: clamp(32px, 6vh, 52px)` and `height: clamp(32px, 6vh, 52px)`.
- **Anti-Clipping:** This links cell bounds directly to the viewport height (vh), ensuring the entire 6 rows of dates are visible without bottom overflow or layout clipping under the no-scroll constraint.
- **Horizontal Centering:** Centered the entire grid container horizontally within the left column space using `align-items: center` on `.calendar-grid-wrapper`.

### Task 2 — Shift Week Index Structure (Monday Start)
- **Monday First:** Shifted `WEEKDAYS` array headers sequence to start on Monday (`MON`) and terminate on Sunday (`SUN`).
- **Monday Padding Mappings:** Rewrote computed `startPadding` calculation to correctly map the weekday offset: `dayOfWeek === 0 ? 6 : dayOfWeek - 1`.

### Task 3 — Unlocked Month Navigation
- **Future Month Navigation:** Removed the disabled attribute from the next month button (`#next-month-btn`), allowing users to freely navigate forward into future months.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2C: Final Calendar Layout Alignment & Modular Cell Integration

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — CSS Grid Jitter & Row Separation Bug Fix
- **Row Separation Bug Fixed:** Configured the `.calendar-grid` parent component to use `grid-template-rows: 24px repeat(6, min-content);` to prevent fractional row heights stretching cells and creating dead vertical whitespace gaps.
- **Fluid 1fr Column Partitioning:** Changed columns definition to `grid-template-columns: repeat(7, 1fr);` with `gap: 6px;` and removed `justify-content: space-between;` to stretch cells horizontally edge-to-edge with the stats cards.

### Task 2 — Enforced Monday-Start Calendar Shift
- **Monday Start Mappings:** Shifted the grid template offset logic dynamically to Monday start: `dayOfWeek === 0 ? 6 : dayOfWeek - 1`.
- **42 Stationary Cell Layout:** Remapped trailing placeholder empty cells to ensure exactly 42 elements are rendered, avoiding grid shift on month navigation.

### Task 3 — Modular CalendarCell.vue Component
- **Component Separation:** Encapsulated `.calendar-grid__cell` styles, states (`--today`, `--checked`, `--future`, `--empty`), checkmark SVG indicators into `CalendarCell.vue`.
- **Responsive Square Scaling:** Set `width: 100%;` and `aspect-ratio: 1 / 1;` with a `max-height: 6vh;` constraint on cells, allowing them to stretch horizontally to claim all column territory while preventing text clipping on short screens.
- **Integration:** Replaced direct DOM rendering inside `CalendarView.vue` template with the modular `<CalendarCell>` component.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2D: Global Progress Bars Uniformity & 6-Metric Milestone Overhaul

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Absolute Progress Bar Uniformity
- **Continuous Progress Track:** Wiped out all segmented/battery blocks logic from `AppProgressBar.vue`, forcing all progress bars on the calendar view to render as a single, continuous flat line track.
- **X / Y Format:** Enforced clear formatting for the login streak tracker and online timer to display as `X / Y days` and `X / Y hours` respectively.

### Task 2 — Overhaul to 6 Achievements
- **6 Achievements Engine:** Overhauled backend `rankEngine.ts` and user controller to track and compute 6 achievements:
  1. Likes received (`likes_X`): caps at 1M likes.
  2. Comments received (`comments_X`): caps at 1M comments.
  3. Posts count (`posts_X`): caps at 100 posts.
  4. Followers count (`followers_X`): caps at 1M followers.
  5. Following count (`following_X`): caps at 1M followings.
  6. Total online hours (`hours_X`): caps at 100 hours.
- **Score Duplication Defense:** Ensured points from milestones are treated as one-time continuous unlocks by verifying against the `user.achievements` locked-flags tracker.
- **Frontend Milestones Loop:** Replaced hardcoded row rendering in `CalendarView.vue` with a data-driven achievements array iterating over the 6 metrics dynamically.

### Task 3 — Layout Realignment & Popover
- **Synced Metric Card Heights:** Aligned all 3 upper cards inside `.stats-row` and centered the health warning text block directly beneath them.
- **Rules Dialog:** Placed a `?` anchor next to the Rank Progression title that toggles a floating flat popup listing thresholds and leveling rules.
- **Compact Rank Label:** Removed the vertical timeline list, displaying only the Current Rank name (left-aligned) and Next Target Rank name (right-aligned) below the progression bar to conserve viewport height.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Step 15 - Part 2E: Spacing Cleanup, 7-Achievement Row Overhaul, and Cell Heights Fine-Tuning

**Date:** 2026-05-27  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Simplified Reward Labels & 7th Achievement Row
- **Reward Label Cleanup:** Cleaned up reward point text to render simply as `+{{ item.rewardPoints }} pts`, completely removing the `on completion` suffix.
- **7-Row Achievement Layout:** Restored the 7th milestone row 'Kỷ nguyên gắn kết' to track continuous login history (`highestStreak`), displaying as a single continuous line capped at 365 days with `X / Y days` formatting.

### Task 2 — Disambiguated Time Tracking Metrics
- **Today vs. Lifetime:** Kept the upper card dedicated to today's active minutes (resetting daily at midnight), while the 'Tổng thời gian đồng hành' achievement row tracks global accumulated hours computed from `totalTimeOnline` divided by 60.

### Task 3 — Refined Calendar Cell Heights
- **Taller Cell Footprint:** Shifted calendar cell heights to `height: clamp(34px, 6.5vh, 56px);` to nới nhẹ chiều cao. Verified that the grid fits perfectly within the container boundaries without scrolling or layout shifts.

```
TypeScript: 0 errors (BE) | 0 errors (FE)
```

---

## Session Log — 2026-05-27 (UI Polish: Dialog Overhaul + Avatar Fix)

### Task 1 — Post Detail Modal: Locked Dimensions & Split Layout (`PostDetailModal.vue`)
- **Hard-locked container:** `width: 760px`, `height: 80vh`, `max-height: 80vh`, `max-width: calc(100vw - 32px)`. Removed all auto-scaling (`max-height: calc(100dvh - ...)` pattern). Dialog footprint is now completely stable regardless of content length.
- **Split-body architecture:** Divided the modal body into two isolated sections:
  - `.modal-post-body` (`flex-shrink: 0`, `overflow: hidden`) — contains dream content text, oracle label, and like interaction row. Never scrolls; always visible above comments.
  - `.modal-comments-area` (`flex: 1`, `overflow-y: auto`) — isolated scroll zone for comment list. Renders its own scrollbar independent of the post body. `bodyRef` now targets this element for auto-scroll-to-bottom after submitting a comment.
- **Empty state placeholder:** When `focusedComments.length === 0`, renders centered `<div class="modal-comments-empty">Chưa có bình luận nào.</div>` with `min-height: 120px`, `opacity: 0.6`, `font-style: italic`. No blank space or layout collapse.
- **Input bar:** Remains `flex-shrink: 0` anchored at absolute bottom of the flex column, never scrolls away.

### Task 2 — Avatar Initials Bug Fix: `getInitials()` + Header Binding (`mockUsers.ts`, `MainLayout.vue`)
- **Root cause:** `getInitials` split on single space `' '` — any name with multiple consecutive spaces or an empty string produced `undefined` character access, resulting in an empty render. The header also passed `?? 'Me'` which masked when `display_name` was an empty string (not null/undefined).
- **Fix in `mockUsers.ts`:** Refactored `getInitials` to:
  - Trim input and guard against blank/null: returns `'?'` for empty names.
  - Split on regex `\s+` and filter empty tokens before mapping first characters.
  - Handles Vietnamese multi-word names like `'Hoàng Dương'` → `'HD'` correctly.
- **Fix in `MainLayout.vue`:** Changed fallback from `?? 'Me'` to `?? ''` so `getInitials` receives the actual name and the hardened utility applies the `'?'` fallback itself when appropriate.

### Task 3 — Calendar Cell Height (`CalendarCell.vue`)
- Updated height constraint: `clamp(38px, 7.2vh, 62px)` → `clamp(42px, 8vh, 68px)`.
- `width: 100%` preserved to fill `1fr` grid tracks without horizontal overflow.

### Task 4 — Lifetime Hours Fix (`CalendarView.vue`)
- **Bug:** `totalHoursVal = Math.floor(totalTimeOnline.value / 60)` omitted today's live minutes and crushed sub-hour values to 0.
- **Fix:** `totalCombinedMinutes = totalTimeOnline.value + timeOnlineToday.value`, then `Math.round(totalCombinedMinutes / 60)`. With `timeOnlineToday = 135m` the display now immediately shows `2 / 10 hours`.

TypeScript: 0 errors (FE) | vue-tsc --noEmit clean
```

---

## Session Log — 2026-05-27 (Notification Routing, Card Click Isolation & Header Avatar Initials Fix)

### Task 1 — Notification Click-to-Dialog Routing Engine (`MainLayout.vue`, `HomeView.vue`)
- **Smart Routing in Dropdown:** In `MainLayout.vue`'s `handleNotificationClick(notif)`, routing is updated for post-related notification types to use Vue Router navigation back to the Home feed `/` with a query parameter `openPostId`: `await router.push({ path: '/', query: { openPostId: notif.postId } })`.
- **Immediate Lifecycle Watcher:** Inside `HomeView.vue`'s `onMounted`, checks if `route.query.openPostId` is present, and immediately triggers `postStore.openPost(route.query.openPostId)`. Added a reactive `watch` on `route.query.openPostId` to handle post opening when the user is already on the Home feed.

### Task 2 — Isolated Card Click Zones (`DreamCard.vue`)
- **Root click handler:** Added `@click="openModal"` to the root `<article class="dream-card">` container to trigger post details modal when clicking blank spaces, text prose, or empty paddings.
- **Edit Mode Guard:** Hard-locked `openModal` to return early if `editMode.value` is true, ensuring clicking inside the inline editor does not launch the modal.
- **Bubbling Prevention & Direct Routing:** Added `@click.stop="navigateToProfile"` explicitly on the avatar (`.dream-card__avatar`), display name (`.dream-card__name`), and handle/username (`.dream-card__username`) HTML tags. Standardized navigation in `navigateToProfile` to run `router.push('/profile/' + props.user._id)`. All bottom row actions (Like and Comment buttons) and owner dropdown trigger are strictly equipped with `@click.stop` to prevent accidental modal triggers.

### Task 3 — Header Avatar Initials Bug (`MainLayout.vue`)
- **Computed Wrapper:** Implemented `headerInitials` in `MainLayout.vue` to check `authStore.user?.display_name || authStore.user?.username || ''` and pass it to `getInitials()`, protecting initials calculation from evaluating to `?` on page switches or lazy API loads.
- **Fallback Binding:** Bound `headerInitials` directly to the avatar fallback slot text node in the `<template>` of `MainLayout.vue`.

TypeScript: 0 errors (FE) | vue-tsc --noEmit clean
```

---

## Session Log — 2026-05-27 (Scroll-to-Post on Notification, Achievements Domain Rename, Hover Pointer)

### Task 1 — Scroll-to-Post on Notification Click (`HomeView.vue`, `DreamCard.vue`)
- **Dynamic ID Injection:** Added dynamic `:id="`dream-card-${dream._id}`"` to the root `<article>` element in `DreamCard.vue`.
- **Smooth Scroll Integration:** Added a `scrollToPost(postId)` helper in `HomeView.vue` using `nextTick` to wait for DOM updates, select the post card element by ID, and execute `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`. This is triggered simultaneously when executing `postStore.openPost(postId)` on mount and inside the query param watcher.

### Task 2 — Global Domain Rename from Calendar to Achievements (`AppSidebar.vue`, `router/index.ts`, `MainLayout.vue`, `AchievementsView.vue`)
- **Sidebar Navigation:** Renamed navigation item `'Calendar'` to `'Achievements'`, updated `id` to `'achievements'`, `to` path to `/achievements`, and swapped calendar icon for a clean medal icon in `AppSidebar.vue`.
- **Router Configuration:** Updated `fe/src/router/index.ts` to route `/achievements` to `AchievementsView.vue`. Renamed source file `CalendarView.vue` to `AchievementsView.vue`.
- **Page Heading Title:** Updated title mapping in `MainLayout.vue` for `/achievements` route to return exactly `'Achievements'`.

### Task 3 — Post Card Hover Cursor State (`DreamCard.vue`)
- **CSS cursor:** Added `cursor: pointer;` to the `.dream-card` class inside the `<style scoped>` sheet of `DreamCard.vue`, visually highlighting that the card is fully interactive.

```
TypeScript: 0 errors (FE) | vue-tsc --noEmit clean
```

---

## RUN 1 — Stabilize the Flow and Remove Obvious Wrong UI

**Date:** 2026-06-09  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Backend error sanitization and payload structure
- **Sanitized Errors:** Implemented `sanitizeError` helper in `BE/src/controllers/moderationController.ts`. Any DB errors, connection strings, secrets, local directories, or trace logs are redacted before reaching user-facing endpoints.
- **Payload alignment:** The endpoint `POST /api/moderation/sources/:id/analyze-rules` now outputs a safe structured JSON containing: `sourceId`, `preparedRAG`, `extractedRules`, `createdCount`, `existingCount`, `candidateIds`, and `message`.
- **Approved checks:** Check if the academic source already contributed approved rules, returning a clear `alreadyApproved` status and message instead of running extraction.
- **Needs Edit status:** The endpoint `GET /api/moderation/rule-candidates` maps `status=pending` query transparently to return both `pending` and `needs_edit` candidates.

### Task 2 — Source action button unification
- **Unified button styling:** In `LibrarySourceDetailView.vue`, replaced the broken HTML layout and customized the main action button "Phân tích để lấy luật" with a flat, neutral white style (`variant="secondary"`), free from emojis/icons.
- **Approved warning status:** Displays the warning text "Tài liệu này đã đóng góp các quy luật được phê duyệt" when `hasApprovedRules` is true.

### Task 3 — Review UI Polish & Emojis cleanup
- **Removed Obvious Wrong UI:** In `RuleCandidatesView.vue`, cleaned up the description subtitle and removed pictograph emojis (`🔒`, `🗂️`, `🔍`, `✓`, `✕`, `⚙️`, `ℹ️`, `👁`).
- **Renamed headers:** Renamed `"AI sẽ dùng khi nào?"` to `"Điều kiện áp dụng"`, `"Diễn giải đề xuất cho AI"` to `"Hướng dẫn phân tích"`, and `"⚙️ Chỉnh sửa nâng cao / Capo"` to `"Chỉnh sửa nâng cao"`.
- **Warning text & Footnote cleanup:** Removed the generic medical/psychological warning spam paragraph from the limitations card (showing only specific limits) and deleted the technical footnote containing `proposedRuleId` at the bottom of the candidate document.

### Task 4 — Regression Fix (Library Source Detail Navigation)
- **What Broke:** Navigating to the Library book/source detail page failed to dynamically import `LibrarySourceDetailView.vue`.
- **Exact Root Cause:**
  1. Stray duplicate `catch` and `finally` blocks (leftovers from a merge conflict) at lines 721-729 in `LibrarySourceDetailView.vue` broke component compilation.
  2. Unused function `getTrustLevelNote` in `RuleCandidatesView.vue` (since its usage in the template was removed in RUN 1) broke the strict frontend compilation check.
- **What Code Was Fixed:** Deleted stray duplicate blocks in `LibrarySourceDetailView.vue` and removed the unused `getTrustLevelNote` method in `RuleCandidatesView.vue`.
- **Command Run:** `npm run build` completed successfully without any compilation errors.
- **Proof of Verification:** Spat a browser subagent which navigated to the library details page, confirming it loads normally, returns correct data, and works flawlessly.

### Task 5 — Fix Backend 500 on `/analyze-rules` (Ollama Embedding Input Length Exceeding Context Limit)
- **Problem:** Attempting to analyze rules for the source document `6a270fcd7e7a11c69a9ace0c` failed with `POST /api/moderation/sources/:id/analyze-rules 500 (Internal Server Error)`.
- **Exact Root Cause:** During the chunk accumulation step, the max character limit was clamped at 8000 characters and 1200 words. Source `6a270fcd7e7a11c69a9ace0c` contains a dense table of numbers (metrics like `0.977±0.004` and arrows `↑`). When tokenized, decimal numbers and mathematical symbols explode into a high number of subword tokens. This token explosion caused the payload for Chunk 4 (which contains the table) to exceed the 2048-token context length of the `nomic-embed-text:latest` model, causing Ollama's embeddings endpoint to fail with HTTP status 500 and message `{"error":"the input length exceeds the context length"}`.
- **Fixes Applied:**
  1. Reduced the chunk sizes and accumulation thresholds to a safer boundary: heading word limit lowered to 300 words, split threshold lowered to 600 words, chunk length capped at 4000 characters, accumulation flush threshold lowered to 600 words, and split overlap adjusted to 400/500 words. This ensures dense text/tables tokenize safely within the 2048 token limit.
  2. Updated the success response structure in `BE/src/controllers/moderationController.ts` to include `chunkBuildStatus` and `extractionStatus` at the top level and inside the nested `data` field, matching the requested shape.
  3. Ensured that failure responses caught during chunk building update the database `source.chunkBuildStatus = 'failed'` and return a constant safe `message` and a `sanitized error` (with redacted local file paths and database connection URIs), containing no raw stack traces.
  4. Updated `FE/src/store/useExtractionStore.ts` to parse the backend-returned `error` property first, falling back to `message` or generic errors, and to properly handle failure by terminating the loading state and minimizing the progress overlay.
- **Commands Run:**
  - `npm run typecheck` (in `BE`) -> Passed successfully.
  - `npm run build` (in `FE`) -> Passed successfully.
- **Proof of Verification:** Spat a browser subagent which navigated to the source detail page, clicked "Phân tích để lấy luật", observed the progress modal transitions smoothly to 100%, and successfully verified that rule candidates were extracted. Then, approved a candidate rule and verified it shifted to the "Tất cả luật" tab as "Đã duyệt".

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 2 — Fix Backend Extraction Quality

**Date:** 2026-06-09  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Backend Programmatic Duplicate Prevention
- **Exact Duplicate Skipping:** Enforced backend checking against both `KnowledgeRuleCandidate` and live `KnowledgeRule` records. Exact duplicate candidates (same normalized label + factor) are programmatically skipped after receiving LLM outputs, instead of being inserted into the database.
- **Semantic Overlap Flagging:** Programmatically checks candidate fields (label, factor, category, scientificBasis, evidenceSummary) against other candidates in the batch, existing database candidates, and active live rules. Semantic overlaps are flagged with `conflictStatus = 'duplicate_or_overlap'` and populated with detailed `conflictNotes` describing the overlap.
- **Live Rules Chunk Check:** Retrieves active rule linkages via `KnowledgeRuleSource` and checks if the new candidate's supporting chunk IDs overlap with any live rule's chunks, flagging overlaps accordingly.

### Task 2 — Helper Functions Refactoring & Clean Code
- **Deduplication:** Moved shared text processing, sentence splitting, excerpt cleaning, and excerpt extraction helpers out of `moderationController.ts` and into `ruleCandidateExtraction.service.ts`.
- **Exported Helpers:** Helper functions are now exported from `ruleCandidateExtraction.service.ts` and imported into `moderationController.ts` (e.g. `splitIntoSentences`, `cleanExcerptText`, `extractExcerptsFromChunk`), avoiding duplicate helper implementations.

### Task 3 — Excerpt and Input constraints
- **Clean Excerpts:** Modified extraction service to strictly run `isValidCleanExcerpt` on chunks. If no clean excerpt can be produced from supporting chunks, `evidenceExcerpts` returns `[]` instead of falling back to dirty chunks or raw paragraphs.
- **Legitimacy Evaluation:** Supports both `verified` and `verified_doi` status. Caps opinion or theoretical papers at a maximum legitimacy score of 70%.
- **Input Fields & Backward Compatibility:** Rejects `inputRequired` containing sleep stage keywords (e.g. `REM`, `NREM`, `stage`, `phase`) with validation errors. Restores `'content'` as a valid allowed input field for backward compatibility with existing tests and datasets.

### Task 4 — Automated Test Assertions
- **Milestone B Test Suite:** Added Test 5, Test 6, Test 7, Test 8, and Test 9 to `BE/scratch/verify_milestone_b.js` validating:
  1. Backend duplicate prevention after LLM output.
  2. Live `KnowledgeRule` conflict/overlap checks.
  3. `content` backward compatibility and sleep stage rejection in `inputRequired`.
  4. Excerpts returning empty arrays when all excerpts are dirty.
  5. Deterministic repeated extraction avoiding duplicate inserts.
- **Results:** Both `verify_milestone_b.js` and `verify_rule_candidate_approval.js` pass with 100% success.

### Known Issues
- **Known issue postponed until after RUN 4:** extraction quantity/coverage may be too low because some sources currently produce only 1 candidate rule.

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 3 — Rebuild Review UI

**Date:** 2026-06-09  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Default View Simplification
- **Purged Obsolete Fields:** Completely removed the following obsolete sections and labels from the default view in `RuleCandidatesView.vue`:
  - "Quy luật đề xuất"
  - "AI sẽ dùng khi nào?"
  - "AI sẽ giải thích như thế nào?"
  - "Diễn giải đề xuất cho AI"
  - "Hướng dẫn phân tích" (from default view)
  - "Chỉnh sửa nâng cao / Capo"
  - "Mức diễn giải thận trọng"
  - "Component D" wording, emojis, and icons.
- **Eight Approved Sections:** Restructured the right detail panel to show exactly the 8 approved sections (no more, no less):
  1. **Kết luận rút ra**: Label header + research source citation.
  2. **Tóm tắt từ tài liệu**: `evidenceSummary` text block.
  3. **Cơ sở học thuật**: `scientificBasis` text block.
  4. **Độ tin cậy học thuật**: Programmatic score, level, and legitimacy reason.
  5. **Xung đột hoặc ghi chú liên quan**: Overlaps/conflict status and notes (hidden if `conflictStatus === 'none'`).
  6. **Bằng chứng hỗ trợ**: Clean excerpts list block (hidden if `evidenceExcerpts` is empty).
  7. **Giới hạn nếu có**: Limitations block (hidden if empty or contains only boilerplate safety disclaimers).
  8. **Sticky Actions Footer**: Simple neutral buttons row for Approve, Reject, and Advanced Edit toggle link.

### Task 2 — Generic Limitation Filtering
- **Limitation Filter:** Refactored `isSourceSpecificLimitation` to parse limitations text. It screens out generic safety disclaimers (e.g. "không dùng thay chẩn đoán y khoa/tâm lý", "chỉ dùng như khung diễn giải tham khảo") and hides the "Giới hạn nếu có" section if the limitations text only contains generic disclaimer boilerplate.

### Task 3 — Excerpt and Wide Context Cleanups
- **Clean Excerpts Only:** Added client-side filtering in `selectCandidate` to exclude excerpts containing raw placeholders (e.g., "Paragraph", "Chunk #", "[Heading: ...]"). If all excerpts are dirty/placeholders, `evidenceExcerpts` maps to `[]` and hides the "Bằng chứng hỗ trợ" section completely. No fallback to raw chunk previews is rendered.

### Task 4 — Collapsed Advanced Edit Accordion
- **Subtle Text Action:** Changed the "Chỉnh sửa nâng cao" CTA from a large button to a subtle primary underlined text action in the sticky actions footer.
- **Default Collapsed:** The accordion is collapsed by default (`showAdvancedEdit = false`) and resets to collapsed on candidate selection or tab changes.
- **Save Button Restricted:** Moved the "Lưu cấu hình nâng cao" save button inside the collapsed accordion only.

### Task 5 — Flat Actions Footer & Sidebar Redesign
- **Sticky Footer:** Replaced any blur, gradient, glassmorphism, purple CTAs, heavy shadows, or icons in the footer layout with a flat, clean row.
- **Tabs Redesign:** Replaced all previous tabs with exactly three: "Tất cả luật", "Chờ duyệt", and "Bị từ chối".
- **Source Group Heading:** Headings grouping candidates by source are styled small and visually distinct with a top margin of 16px and bottom margin of 6px.
- **Rule Cards Layout:** Cards display exactly rule label as main text, and a bottom row containing the status badge on the left and the creation date/time right-aligned on the right. Repeats of citation, proposed ID, and horizontal scroll are entirely removed.
- **Safe Clear All:** Displayed a "Xóa tất cả bị từ chối" link in the rejected tab, wired to the safe backend bulk deletion confirmation modal.

### Verification
- **Compilation Check:** Verified frontend (`npm run build` in `FE`) compiles cleanly with 0 TypeScript/Vite-TSC errors.
- **Backend Check:** Verified backend (`npm run typecheck` in `BE`) compiles cleanly with 0 TypeScript errors.

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 3 Polish — Final UI Corrections

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Advanced Edit & Approve/Reject Button Styles Restored
- **Accordion Header Trigger Restored:** Added back the toggle button inside the `advanced-collapsible-section` accordion header to keep the simple open/close toggle interaction. It defaults to collapsed and expands/collapses cleanly when clicked.
- **Button Styling:** Restored the familiar styles of `Approve` (`variant="smart"`) and `Reject` (`variant="danger-outline"`) buttons in the general actions footer instead of flat links or secondary variants.

### Task 2 — Limitations Section Removed from Default View
- **Limitations Hidden:** Removed the "Giới hạn nếu có" section completely from the default read-only detail view of the candidate. The limitations data still exists and is visible/editable inside the "Chỉnh sửa nâng cao" form section.

### Task 3 — Sidebar Redesign & Headings Visibility
- **Source Titles Readability:** Improved contrast and font styling for `.source-group-header` headings in the sidebar (increased size to `0.88rem`, weight to `700`, color to `var(--color-text-primary)`). Spacing adjusted with a larger top margin than bottom margin (`margin: 20px 0 8px 0`).
- **Bulk Delete Positioned at Bottom:** Moved the `"Xóa tất cả bị từ chối"` link from the top of the sidebar list to the bottom-right of the left panel (styled as a subtle red underline text link that hovers brighter). It is only visible in the "Bị từ chối" tab and does not overlap rules list content.

### Verification
- **Compilation Check:** Verified frontend (`npm run build` in `FE`) compiles cleanly with 0 TypeScript/Vite-TSC errors.
- **Backend Check:** Verified backend typecheck compiles cleanly.

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 3 Polish — Redundant UI Cleanups

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Removed Redundant Status Banners & Badge
- **Purged Banners:** Completely removed the large status notice banners (`approved-banner`, `deactivated-banner`, and `rejected-banner`) from the top of the detail scroll area.
- **Removed Repeated Badge:** Removed the status badge header (`status-badge-lg` inside `.review-document-header`) from the top of the `Kết luận rút ra` document card, letting the detail page start cleanly with rule content.

### Task 2 — Removed Duplicated Trigger link
- **Eliminated Footer Trigger:** Removed the duplicate underlined `"Chỉnh sửa nâng cao"` toggle link from the sticky actions footer.
- **Single Accordion Behavior:** Kept only one Advanced Edit control trigger (the accordion header button on `advanced-collapsible-section`) which defaults to collapsed, toggles open/close correctly, and contains the entire configuration form and save changes button inside.

### Verification
- **Compilation Check:** Verified frontend (`npm run build` in `FE`) compiles cleanly with 0 TypeScript/Vite-TSC errors.
- **Backend Check:** Verified backend typecheck compiles cleanly.

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 3 Polish — Section Header Cleanup

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Removed Repeated Title Heading
- **Removed Heading Label:** Removed the `"Kết luận rút ra"` section label span (`section-label-heading`) completely from the top of the detail view card. The detail view now starts directly with the actual conclusion title and source citation.

### Verification
- **Compilation Check:** Verified frontend (`npm run build` in `FE`) compiles cleanly with 0 TypeScript/Vite-TSC errors.
- **Backend Check:** Verified backend typecheck compiles cleanly.

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 3 Polish — Readability and Term Normalization

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Backend & Frontend Academic Term Normalization
- **Vietnamese Academic Terms:** Added Vietnamese academic term normalization (`normalizeVietnameseAcademicTerms` in BE and `normalizeVietnameseTerms` in FE).
- **Correct Mapping:** Converts bad/literal translations such as `consolization ký ức`, `consolidation ký ức`, `quá trình consolization`, and `ổn định hóa trí nhớ` (in memory context) into natural academic Vietnamese: `củng cố ký ức`.
- **Pre-saving Normalization:** Enforced normalization on backend-saved candidate fields (label, category, factor, scientificBasis, aiInstruction, limitations, evidenceSummary, legitimacyReason, conflictNotes) during candidate extraction in `ruleCandidateExtraction.service.ts`, preventing database pollution.
- **On-the-fly Display Mapping:** Applied identical normalization during list and detail selection mapping in `RuleCandidatesView.vue` as a fallback.

### Task 2 — Programmatic Metadata Strip & Content Conversions
- **Strip Raw Tags:** Implemented `stripMetadataLabels` in frontend component to remove raw metadata tags (`Trạng thái trùng lặp/xung đột:`, `Loại bằng chứng:`, `Ghi chú xung đột:`, `Mức độ hợp lệ:`, `Lý do đánh giá:`) and raw enums from candidate notes/reasons.
- **Natural Paragraph Explanations:**
  - **Conflict Status:** Converted `conflictStatus` values (`supports_existing_rule`, `duplicate_or_overlap`, `conflicts_with_existing_rule`) into descriptive Vietnamese sentences (e.g. "Kết luận này bổ sung cho một luật đã có...").
  - **Legitimacy Level & Evidence Type:** Converted legitimacy fields into cohesive readable paragraph reviews combining ratings, levels, and specific study type comments (e.g. "Độ tin cậy ở mức trung bình vì đây là bài viết thiên về khung lý thuyết...").
- **Section Visibility:** Hides the conflict section entirely if status is `none`.

### Task 3 — Sentence Deduplication
- **Clean Notes:** Added sentence deduplication (`deduplicateConflictNotes` in BE and `deduplicateSentences` in FE) using Sets and whitespace/newline splitting to prevent repeated lines like "Trùng lặp bằng chứng học thuật với ứng viên hiện có." from being stored or rendered multiple times.

### Verification
- **Compilation Check:** Verified frontend (`npm run build` in `FE`) compiles successfully with 0 errors.
- **Backend Check:** Verified backend (`npm run typecheck` in `BE`) compiles successfully with 0 errors.
- **Backend Test Suite:** Executed `verify_milestone_b.js` and `verify_rule_candidate_approval.js` test suites, passing all 9 milestones and review validation checks (100% success).

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## RUN 4 — Safe Management Actions, Database Audit, and Code Cleanup

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — 0 TypeScript errors (BE & FE)

---

### Task 1 — Safety Restrictions on Rule Deactivation
- **deactivateSourceRules Fix:** Modified `deactivateSourceRules` in `moderationController.ts` to query target rules beforehand. It deactivates only rules where `origin === 'source_generated'`. Seed and manual rules connected to the academic source are guaranteed to remain untouched.
- **Selective Link & Candidate Deactivation:** Links in `KnowledgeRuleSource` and candidates in `KnowledgeRuleCandidate` are updated status to inactive/rejected only if they belong to those `source_generated` rule IDs.

### Task 2 — Request Body Confirmation Validations
- **Strict Payload Guards:** Enforced backend request body checks for all destructive actions:
  - `deactivateRule` requires `confirm === true` (verified `origin === 'source_generated'` check).
  - `deactivateSourceRules` requires `confirmationText === 'CONFIRM'`.
  - `deleteCandidate` requires `confirm === true` (verified status must be `'rejected'`, rejects others).
  - `clearAllRejectedCandidates` requires `confirmationText === 'CONFIRM'` (deletes only candidate records with `status === 'rejected'`).

### Task 3 — Database Audit Script
- **Audit Script Location:** Created `BE/scripts/audit_db_cleanup.js`.
- **Dry-run Only:** Deletion is strictly disabled (`DELETE_ENABLED = false`) for RUN 4. Standard report dry-run mode only.
- **Split Classification:**
  - **Safe test namespace records:** Matches strict test prefixes (e.g. `Test Verify`, `RAG Test`, `verify_` etc.) created by verification scripts.
  - **Suspicious records:** Matches keywords like "test", "mock" etc. outside strict namespaces.
  - **Dangerous collections (audit-only):** Audits matches in `users` and `dreams` with zero deletion permitted.
- **Structural Integrity Checks:** Performs orphan analysis, active/inactive mismatch detections, candidates with missing sources/chunks, and live rules with invalid origins.
- **App Behavior Impact Assessment:** Inspects if deleting safe test records would affect active live rules or parent sources, warning the user of any impact before doing anything.

### Task 4 — Dead Code Cleanup
- **API Cleanup:** Deleted the unused `buildSourceChunks` function from `FE/src/api/moderationApi.ts` after search proof showed zero imports and zero references in the frontend codebase.

### Verification
- **FE Compilation:** Frontend builds cleanly with 0 TypeScript/Vite-TSC errors.
- **BE Typecheck:** Backend type-checks with 0 errors.
- **Test Suites:**
  - `verify_rule_candidate_approval.js` (Passed all validations).
  - `verify_deactivation_rules.js` (Created and ran, successfully asserted seed/manual deactivation guards and body confirmation requirements).
  - `audit_db_cleanup.js` (Executed successfully in dry-run mode, reported zero integrity failures and classified test profiles).

### Known Issues
- Known issue "some sources only produce 1 rule candidate" left for the post-RUN-4 extraction/data reset redesign phase.

---

## Session Log — 2026-06-10 (Full MongoDB Collection and Schema Usage Audit)

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — Read-only DB audit completed, no data modified.

---

### Task 1 — MongoDB Schema and Field Audit
- **Inspected Models:** Inspected all 18 backend schema files in `BE/src/models/` and compiled a full report detailing all properties, types, default values, enums, required states, and indexes.
- **Identified Redundant Fields:** 
  - `dreams.aiAnalysis` is schema-only and explicitly deleted before save.
  - `dreams.visibility` duplicates `privacy`.
  - `dreams.dreamText` duplicates `content`.
  - Duplicate birth fields in `users` (`birth_date`, `birth_hour`, `fullName`, `gender`) are duplicate/mirrored in `user_dream_profiles.basicProfile`.

### Task 2 — Special User-Domain Verification
- **User Achievements vs Standalone:** Determined that `User.achievements` acts as a global mirror cache of contribution milestones from `user_achievements` plus all user social and login activity milestones.
- **Contribution Stats Separation:** Confirmed that `user_contribution_stats` keeps the core `User` document lean and acts as a derived cache generated by indexing the `source_contributions` collection.
- **User Dream Profiles Audit:** Proved that `user_dream_profiles` is not obsolete, is recreated automatically on registration or profile changes, and stores personalized analysis variables for the Oracle.

### Task 3 — Integrity and Orphan Checker
- **Custom Audit Script:** Created `/Users/helloduongnha/Documents/DreamScape/BE/scratch/db_integrity_audit.js` to execute 15 orphan validation queries against the active MongoDB database.
- **Orphan Comments Detected:** Discovered **14 orphan comments** in the database pointing to non-existent dreams due to the absence of cascade deletions on dream removal.
- **No Data Modified:** Verified all audits are 100% read-only. Created final summary report at `BE/DB_USAGE_AUDIT.md`.

---

## Session Log — 2026-06-10 (Safe Database Cleanup Phase & Personalization Model Refactor)

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — Cascade delete, Mongoose model refactor, dry-run cleanup scripts, and test suite passed successfully. No user documents, real dreams, comments, academic sources, rules, candidates, or profile data were modified. The only database mutation was dropping the empty legacy collection `knowledgerulecandidates` after verifying it was unused and empty.

---

### Task 1 — Cascade Deletion implementation
- **Comments & Notifications Cascade:** Modified the `deleteDream` controller in `BE/src/controllers/dreamController.ts` to automatically cascade delete:
  - All comments in the `comments` collection linked to the deleted dream.
  - All notifications in the `notifications` collection linked to the deleted dream (verified using the schema field `postId`).

### Task 2 — Formalized Mongoose Model for user_dream_profiles
- **Flexible Schema Created:** Created [UserDreamProfile.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/UserDreamProfile.ts) mapping the `user_dream_profiles` collection with flexible `Schema.Types.Mixed` properties to avoid casting errors on dynamic nested keys.
- **Controllers & Services Refactoring:** Replaced raw `db.collection('user_dream_profiles')` query stubs inside `authController.ts` and `analyze.service.ts` with standard Mongoose queries (`UserDreamProfile.findOne().lean()`, `UserDreamProfile.updateOne()`), maintaining exact upsert and default fallbacks.

### Task 3 — Dry-run Cleanup Scripts
- **Orphan Comments:** Created `BE/scripts/cleanup_orphan_comments.js`. Running it in default dry-run mode audited and printed the IDs of the 14 orphan comments in the database.
- **Legacy Candidates Drop:** Created `BE/scripts/drop_legacy_candidates.js`. Audited active model target config (`knowledge_rule_candidates`) and verified safety indicators. Legacy empty collection `knowledgerulecandidates` was safely dropped from database.
- **Verification Tests:** Created `BE/scratch/verify_cascade_and_cleanup.js`. Ran it successfully; verified:
  - Isolated test dream deletion cascade deletes test comments and test notifications.
  - Deleting a test dream leaves comments on other dreams untouched.
  - Dry-runs do not modify database states.
  - Re-asserted zero backend type-checking errors (`npm run typecheck`).

```
TypeScript: 0 errors (BE) | Build: success
```

---

## Session Log — 2026-06-10 (Phase A: Schema Slimming & Audit Foundation)

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — Legacy candidate fields audited and removed from schemas, models, controllers, and APIs. Backend type checks and frontend builds pass cleanly.

---

### Task 1 — Legacy Fields Schema & Code Removal
- **KnowledgeRuleCandidate Schema Updated:** Audited and removed the 12 legacy fields (`sourceTitle`, `sourceAuthors`, `sourceYear`, `sourceDoi`, `validationErrors`, `generationWarnings`, `extractionError`, `extractionStatus`, `generationModel`, `generationPromptVersion`, `legitimacyLevel`, `deactivatedAt`) from `KnowledgeRuleCandidate.ts` model.
- **Deactivation Field Removal:** Removed `deactivatedAt` references and status-badge overrides in `moderationController.ts` and `RuleCandidatesView.vue`.
- **Backend Detail Sanitation Cleaned:** Deleted the legacy candidate `extractionError` sanitation block in the candidate details endpoint (`moderationController.ts`).
- **Frontend Type Alignment:** Updated `ruleCandidateApi.ts` types to remove `deactivatedAt`.

### Task 2 — Dedicated Extraction Run Logger
- **Model Registration:** Created the Mongoose schema and interface for `AcademicRuleExtractionRun` in [AcademicRuleExtractionRun.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/AcademicRuleExtractionRun.ts).
- **Type Safety Resolution:** Renamed the run model's `model` property to `generationModel` to resolve type signature collisions with Mongoose's built-in `Document.model` method.

### Task 3 — Dynamic Metadata Mappings
- **Controller Populates:** Configured backend API responses in `moderationController.ts` to populate candidate source metadata dynamically from the reference `academicSourceId`.
- **Frontend Rendering Adjustments:** Refactored `RuleCandidatesView.vue` to fetch source details dynamically from the populated `academicSourceId` sub-object.

### Task 4 — Audit Dry-Run Script
- **verify_legacy_fields.js:** Created a dry-run script `BE/scripts/verify_legacy_fields.js` to query raw MongoDB candidate documents and assert count metrics of residual fields in active collections.
- **Dry-run Execution:** Ran the script, confirming 0 residual legacy fields in the active `knowledge_rule_candidates` database collection.

### Verification
- **BE Typecheck:** Backend type-checks with 0 errors (`npm run typecheck`).
- **FE Compilation:** Frontend builds cleanly with 0 TypeScript/Vite-TSC errors (`npm run build`).

```
TypeScript: 0 errors (BE) | 0 errors (FE) | Build: success
```

---

## Session Log — 2026-06-10 (Phase B: Extraction v2 Backend Implementation)

**Date:** 2026-06-10  
**Status:** ✅ COMPLETE — Overhauled the academic rule extraction system (v2) incorporating relevance checks, candidate keys, safety caps, and execution runs. Automated tests run successfully with zero test leakage.

---

### Task 1 — Hybrid Relevance Gate
- **Heuristics Check:** Implemented keyword heuristics scan on abstract and title text. Correctly flags Computer Vision / neural network papers and skips extraction.
- **LLM Classifier:** Implemented `classifyDomainRelevance` utilizing a lightweight LLM classifier to resolve ambiguous cases.
- **Clean Irrelevant Exit:** Irrelevant documents trigger clean status 200 exits with `domainRelevanceStatus: 'irrelevant'` and descriptive Vietnamese notifications.

### Task 2 — Safety Limit Cap
- **Safety Cap Guard:** Enforces candidate limit of 30. Excess candidates trigger immediate run failure (`status = 'failed'`, `exceedsCandidateCap = true`) and return warnings to prevent partial drops.

### Task 3 — Deterministic Keys & Repeat Extraction
- **Deterministic candidateKey:** Generates unique deterministic keys based on source ID, stable content hash, canonical claim semantic fingerprint, categories, factors, and stable evidence anchors.
- **Repeat extraction updates:** On repeated extraction, matching `candidateKey` values trigger document updates rather than duplicate candidate creations. Derived `proposedRuleId` remains deterministic.

### Task 4 — Automated Test & Test Isolation
- **Leakage Check Script:** Created `BE/scratch/verify_test_leakage.js` checking target database collections for test namespace residue.
- **verify_extraction_v2.js:** Executed V2 extraction tests using mocked fetch. Tested gate exits, cap failures, deterministic keys, repeat updates, and schema validation.
- **Test Isolation Verification:** Confirmed that the `test_extraction_v2_` namespace is fully cleaned up in `finally` blocks, resulting in 0 database leakage.

### Verification
- **BE Typecheck:** Backend typecheck passed with 0 errors (`npm run typecheck`).
- **Automated Tests:** `verify_extraction_v2.js` passed all test cases.
- **Zero Leakage:** `verify_test_leakage.js` verified 0 test residue in target collections.

```
TypeScript: 0 errors (BE) | Tests: success | Leakage check: clean
```

---

## Session Log — 2026-06-11 (Refine Rule Extraction: Evidence Re-Grounding & Chunking Hardening)

**Date:** 2026-06-11  
**Status:** ✅ COMPLETE — Overhauled the evidence mapping pipeline by introducing backend evidence re-grounding and structured prompt context, refactored chunking logic boundaries, verified extraction on target dream psychology DOI `10.3389/fpsyg.2016.00332`, and ensured 0 test leakage.

---

### Task 1 — Alignment of RAG Chunk-Splitting
- **Heading Boundaries:** Fixed chunking logic in the `analyzeRules` controller method in `BE/src/controllers/moderationController.ts` to respect heading boundaries by always flushing accumulated sections upon starting a new heading, matching the logic inside `buildChunks`.
- **Word Limits:** Lowered the minimum word limit for core paragraphs to 40 words, and aligned maximum chunk length (8,000 characters), sub-chunk sizes, and overlap logic between both controllers.

### Task 2 — Structured Prompt Context & evidenceChunkIds
- **Structured JSON Prompt:** Refactored prompt creation in `BE/src/services/ruleCandidateExtraction.service.ts` to serialize RAG chunks as a JSON array of structured objects containing `chunkId`, `sectionTitle`, `sectionType`, `pageStart`, and `text`, instead of using fragile integer index strings.
- **Parametric Schema:** Replaced `supportingChunkIndices` with `evidenceChunkIds` in the Ollama prompt guidelines and schema expectations.

### Task 3 — Backend Evidence Re-grounding
- **calculateOverlapScore:** Added tokenized keyword overlap similarity scoring to match candidate text (`label`, `scientificBasis`, `evidenceSummary`) against chunk content.
- **Dynamic Re-grounding:** If the LLM returns candidates but omits/mismatches chunk identifiers, the backend matches and associates the top 1-5 chunks with positive overlap scores, failing a candidate only if no relevant evidence chunks are found.
- **Diagnostic ReasonCode:** Mapped missing evidence errors to the explicit reasonCode `candidate_evidence_mapping_failed` (returning outcome `stopped_evidence_mapping_failed` via `/analyze-rules`) instead of mapping to generic weak evidence errors.

### Verification
- **BE Typecheck:** Compile check passed with 0 errors (`npm run typecheck`).
- **Target DOI Extraction:** Successfully executed extraction on `10.3389/fpsyg.2016.00332` generating 3 new candidate rules with successfully mapped `evidenceChunkIds` and cautious Vietnamese text.
- **Deepfake DOI Gate:** Confirmed that deepfake DOI `10.1109/tpami.2026.3663547` is cleanly filtered by the relevance gate with outcome `stopped_domain_irrelevant`.
- **Automated Tests:** Both `verify_extraction_v2.js` and `verify_test_leakage.js` passed successfully with 0 residue in MongoDB.

```
TypeScript: 0 errors (BE) | Tests: success | Extraction: 10.3389/fpsyg.2016.00332 success (3 candidates) | Leakage check: clean
```

---

## Step 18: Refine Rule Extraction Coverage, Content Quality & Excerpt Cleaning

**Date:** 2026-06-11  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE and FE)

---

### Task 1 — Section-Level Extraction Loop & Consolidation
- **Section-Level Grouping:** Refactored extraction pipeline to group RAG chunks by heading/section title, executing separate Ollama prompts per section group. This expands coverage across all relevant parts of the paper (Introduction, Memory Consolidation, Self-Organization Theory, and Conclusion).
- **Candidate Consolidation:** Implemented `consolidateCandidates` to deduplicate and merge extracted rules sharing the same label or category-factor pair. Merged entries combine their supporting `evidenceChunkIds` and retain the longest, most detailed string descriptions.
- **Safety Cap Guard:** Rejects batch if candidates exceed 30, updating the extraction run log status to `failed`.

### Task 2 — Programmatic Legitimacy Evaluation & Reason Builder
- **Programmatic Scoring:** Implemented `calculateLegitimacy` to dynamically compute scores, capping opinion/hypothesis papers at 55, literature reviews at 65, and theoretical frameworks at 70.
- **Explanation Builder:** Implemented `buildLegitimacyExplanation` to construct natural Vietnamese paragraphs combining the computed score, research types (empirical study, theoretical framework, review), peer-review flags, and cautions for the Oracle.

### Task 3 — Vietnamese Content Quality & Term Normalization
- **Quality Verification:** Checks candidate fields dynamically. If `evidenceSummary` has <3 sentences or `scientificBasis` has <100 characters, it triggers a one-time LLM refinement prompt (`refineCandidateWording`) to rewrite the fields into caution-oriented, highly detailed Vietnamese text.
- **Vietnamese Academic Normalization:** Implemented `normalizeVietnameseAcademicTerms` to convert literal/incorrect translations (e.g. `consolization ký ức`, `stabilization`, `quá trình consolidation`) into natural academic Vietnamese: `củng cố ký ức`.

### Task 4 — Parenthetical Excerpt Text Cleaning
- **Excerpt Sanitization:** Implemented `cleanExcerptText` to strip bracketed heading/chunk tags, dangling parenthetical citations, ellipses, and unclosed parentheses.
- **Excerpt Validator:** Implemented `isValidCleanExcerpt` to enforce strict formatting requirements (starts with capital/quote/number, ends with punctuation, contains no ellipses, brackets, or isolated years, and length between 100-600 characters). If all excerpts are dirty, `evidenceExcerpts` defaults to `[]` instead of raw paragraphs.

### Task 5 — Unique Conflict Verification
- **Deduplicated Notes:** Dedupes conflict notes using Set collection structures in both service and front-end displays to prevent repeating overlap descriptions (e.g., repeating "Trùng lặp bằng chứng học thuật").
- **Empty Section:** Hides the conflicts block on UI if the conflict status is `none`.

### Verification Results
- **Typechecking:** Verified 0 TypeScript compilation errors in backend (`npm run typecheck`).
- **Unit Tests:** `verify_extraction_v2.js` completed with 100% success (verifying irrelevant heuristics block, safety cap exception, and deterministic candidate keys).
- **Leakage Check:** `verify_test_leakage.js` returned 0 leaks in all active MongoDB collections.
- **Diagnostics Run:** Reran diagnostics on both target DOIs:
  - Deepfake photorealism paper correctly exited as `domain_irrelevant`.
  - Academic dream psychology paper (`10.3389/fpsyg.2016.00332`) successfully extracted 12 high-quality candidates with detailed Vietnamese prose, programmatic legitimacy reasons, and clean excerpts.

```
TypeScript: 0 errors (BE) | Tests: success | Extraction: 10.3389/fpsyg.2016.00332 success (12 candidates) | Leakage check: clean
```
---

## Step 19: Two-Level Domain Classification & Non-Dream Extraction

**Date:** 2026-06-11  
**Status:** ✅ COMPLETE — 0 TypeScript errors confirmed via typechecking (BE)

---

### Task 1 — Two-Level Domain Relevance Classifier
- **classifyPaperDomainAndEligibility:** Upgraded relevance check to determine the paper's domain (`dream_sleep_psychology`, `computer_vision`, `medicine`, `general_science`, or `unknown`) and its Oracle eligibility status (`oracleEligible` boolean).
- **Non-Dream Candidates Extraction:** Non-dream academic papers are no longer blocked. Instead, the pipeline adapts the LLM prompt instructions dynamically, extracting findings and rules native to the paper's actual scientific domain.
- **Custom Eligibility Tags:** All generated candidate rules for non-dream papers are marked with `oracleEligible: false` and their mapped `paperDomain` (e.g. `computer_vision`), ensuring they do not pollute Oracle dream analysis.
- **Custom User Wording:** Successfully returns the custom Vietnamese message when non-eligible candidates are successfully created or updated: *“Tài liệu đã được phân tích, nhưng các kết luận này không dùng trực tiếp cho Oracle giấc mơ.”*

### Task 2 — Verification & Automated Tests
- **Typechecking:** Verified 0 TypeScript compilation errors in backend (`npm run typecheck`).
- **Unit Tests:** `verify_extraction_v2.js` completed with 100% success (verifying two-level classification extraction, safety cap exceptions, and deterministic candidate keys/updates).
- **Leakage Check:** `verify_test_leakage.js` returned 0 leaks in all active MongoDB collections.
- **Diagnostics Run:** Reran diagnostics on both target DOIs:
  - Deepfake photorealism paper extracted 6 candidates with `oracleEligible: false`, `paperDomain: 'computer_vision'`, and the custom Vietnamese notification message.
  - Academic dream psychology paper (`10.3389/fpsyg.2016.00332`) successfully extracted candidates with `oracleEligible: true` and `paperDomain: 'dream_sleep_psychology'`.

```
TypeScript: 0 errors (BE) | Tests: success | Extraction: CV (6 candidates, oracleEligible: false) & Dream Psychology (12 candidates, oracleEligible: true) | Leakage check: clean
```

---

## Session Log — 2026-06-18 (Approved-Rule RAG Link & Dream Analysis Feedback Flow)

**Date:** 2026-06-18  
**Status:** ✅ COMPLETE — Verified approved academic rules in Oracle RAG flow and implemented hypothesis feedback verification.

---

### Task 1 — Hypothesis Feedback Endpoint Safety & Ownership
- **Ownership Verification:** Added a check in `saveHypothesisFeedback` (`BE/src/controllers/dreamController.ts`) verifying that the logged-in user matches the dream owner (`userId`), returning `403 Forbidden` if another user attempts to submit feedback.
- **Payload Validation:** Enforced that `hypothesisIndex` is within the valid index boundaries of `real_life_hypotheses` in `ai_result` / `aiAnalysis` (returning `400 Bad Request` if invalid). Validated that `answer` must be exactly one of `'yes'`, `'no'`, or `'unsure'`.
- **Question Text Integrity:** Extracted `questionText` dynamically from the matched database hypothesis (`followUpQuestion`) to ensure client inputs are not blindly trusted.

### Task 2 — Single Source of Truth & Render Cache Mirroring
- **Database Schema:** Declared `realLifeHypothesesFeedback` schema inside `Dream` model (`BE/src/models/Dream.ts`) containing index, answer, question, user ID, and update timestamp.
- **Mirror Synchronization:** The feedback array acts as the single source of truth. The controller updates this array and mirrors the selected value in the legacy `userFeedback` fields of `ai_result.real_life_hypotheses` and `aiAnalysis.real_life_hypotheses` to maintain backward-compatibility with existing frontend templates without unnecessary structural duplication.

### Task 3 — RAG Link UX Polish & Admin-Only Deletion Protection
- **Sidebar Navigation:** Fully removed the sidebar navigation entry for "Liên kết RAG" in `AppSidebar.vue` to keep the normal moderator flow clean.
- **Page Cleanup:** Hidden technical tags (rule IDs, `GENERATED` tags, status badges) and the "Hủy liên kết" action buttons from the normal moderator view in `KnowledgeEvidenceView.vue`.
- **Admin-Only Unlink:** Restricted the `removeEvidenceLink` delete API (`BE/src/controllers/knowledgeEvidenceController.ts`) to administrator accounts (matching `process.env.ADMIN_USER_IDS` or fallback developer ID `6a0fc84bd37aacb66092be0e`), returning `403 Forbidden` to normal moderators.

### Task 4 — E2E Oracle RAG Rule Verification
- **Oracle Rule Matching:** Successfully verified through automated integration tests (`BE/scratch/verify_oracle_rag.js`) that approving a candidate creates the appropriate `KnowledgeRule` (retaining `oracleEligible: true`, `isActive: true`) and active `KnowledgeRuleSource` link.
- **RAG Dream Analysis:** Confirmed that the dream analysis RAG engine (`runDreamAnalysis`) successfully retrieves and includes eligible rules in `retrievedContext.componentD.appliedRules` and populates source titles correctly in `evidenceLinks`.
- **Frontend Academic Evidence:** Confirmed that the frontend `OracleAnalysisResult.vue` successfully matches and displays the retrieved citations/sources and links them to their detailed view in the Library.

### Verification Results
- **BE Typecheck:** Clean backend compile with 0 TypeScript/TSC errors (`npm run typecheck`).
- **FE Build:** Clean frontend production build compilation using Vite and `vue-tsc` (`npm run build`).
- **Feedback Smoke Test:** Executed `node scratch/verify_feedback.js` confirming ownership enforcement (403), invalid payloads (400), valid persistence (200), and legacy mirror synchronization.
- **RAG Integration Test:** Executed `node scratch/verify_oracle_rag.js` confirming rule creation, rule eligibility, link generation, and retrievedContext matching.

```
TypeScript: 0 errors (BE) | Build: success (FE) | Feedback Tests: success | RAG Integration Tests: success
```

---

## Session Log — 2026-06-18 (Mock Cleanup & Manual RAG Linking UI removal)

**Date:** 2026-06-18  
**Status:** ✅ COMPLETE — Safely deleted leaked mock data matching "Sleep Position and Dream Content" by "Dr. Dreamer", isolated verification tests to `dreamscape_test` database, and fully deleted manual RAG Linking UI/routes from FE and BE.

---

### Task 1 — Safe Mock Data Cleanup
- **Cleanup Script:** Implemented `BE/scripts/cleanup_mock_sources.js` which connects to the active database and resolves associated mock records using the academic source ID. Defaults to dry-run auditing and deletes only when explicitly executed with the `--execute` flag.
- **Cascading Deletions:** Safely pruned matching records across `academic_sources` (2 documents deleted), `academic_fulltexts` (1 document deleted), and all associated collections (`academic_fulltext_sections`, `academic_chunks`, `knowledge_rule_candidates`, `knowledge_rules`, `knowledge_rule_sources`, `academic_rule_extraction_runs`, `source_contributions`).
- **Safety Abort Guard:** Embedded runtime abort check ensuring real academic sources (e.g. containing "Zhang", "Self-Organization", "Deepfake", "DREAM") are never touched.

### Task 2 — Test Isolation & Safe Database Environment
- **Test Relocation:** Configured `BE/scratch/verify_oracle_rag.js` and `BE/scratch/verify_feedback.js` to connect only to the isolated test database `dreamscape_test`.
- **Name Verification Abort:** Added strict verification check in test runs to assert that `mongoose.connection.name` is exactly `dreamscape_test`, aborting execution immediately if not.

### Task 3 — Manual RAG Linking UI Removal
- **Files Deleted:** Completely deleted `FE/src/features/moderation/KnowledgeEvidenceView.vue` and `FE/src/api/knowledgeEvidenceApi.ts`.
- **Navigation & Breadcrumbs:** Removed the `'Liên kết RAG'` breadcrumb mapping in `MainLayout.vue` and cleared commented sidebar navigation reference in `AppSidebar.vue`.
- **Router Redirect:** Refactored the route registration in `FE/src/router/index.ts` so that direct attempts to access `/moderation/knowledge-evidence` redirect to `/moderation/rule-candidates`.
- **Backend Route Polish:** Commented out and disabled manual link/unlink route registrations (`createEvidenceLink`, `getEvidenceLinks`, `removeEvidenceLink`, `searchSourceChunks`) in `BE/src/routes/moderationRoutes.ts` while keeping the approved rules listing active for moderation.

### Verification Results
- **BE Typecheck:** Backend compiles cleanly with 0 type-checking errors (`npm run typecheck`).
- **FE Build:** Frontend builds cleanly with 0 type-checking/Vite compilation errors (`npm run build`).
- **Tests Execution:** Both `verify_feedback.js` and `verify_oracle_rag.js` executed and passed successfully, verifying automatic approved-rule `KnowledgeRuleSource` creation and Oracle matching on the isolated `dreamscape_test` database.
- **Audit Verification:** Confirmed that 0 mock records matching `Dr. Dreamer` or `Sleep Position and Dream Content` remain in the live development database.

```
TypeScript: 0 errors (BE) | Build: success (FE) | Cleanup: complete (0 mock records) | Tests: isolated & success
```

---

## Session Log — 2026-06-18 (Production Cleanup of Temporary/Scratch Files)

**Date:** 2026-06-18  
**Status:** ✅ COMPLETE — Fully removed obsolete verification scripts and scratch/debug files to clean up the workspace for production review.

---

### Task 1 — Scratch Files Deletion
- **Scratch Directory Cleanup:** Deleted all 40 temporary development, testing, and debugging script files in `BE/scratch/`.
- **Directory Removal:** Removed the empty `BE/scratch` folder.

### Task 2 — Obsolete Scripts Deletion
- **Targeted Scripts Deleted:** Deleted the following 8 obsolete verification and clean-up files from `BE/scripts/`:
  - `cleanup_mock_sources.js`
  - `verify_wizard.js`
  - `verify_legacy_fields.js`
  - `verify_phase1.js`
  - `verify_phase1_in_process.ts`
  - `verify_phase2_in_process.ts`
  - `verify_phase3_in_process.ts`
  - `verify_phase4_in_process.ts`
- **Retained Scripts:** Kept 12 core administrative utility scripts in `BE/scripts/` untouched.

### Task 3 — Workspace Search & Reference Audit
- **Import Check:** Grepped the entire repository and verified that no production code paths, routing files, package scripts, or app startup logic contain imports or active references to any of the deleted files.
- **Historical Log Integrity:** Retained historical mentions of the deleted verification files inside developer logs and walkthroughs as historical context.

### Verification Results
- **BE Typecheck:** Successfully verified backend codebase with 0 errors via `npm run typecheck`.
- **FE Build:** Successfully verified frontend build compilation with 0 errors via `npm run build`.

```
TypeScript: 0 errors (BE) | Build: success (FE) | Cleanup: complete (Scratch & Obsolete scripts deleted)
```


