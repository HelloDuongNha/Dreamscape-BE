import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Conversation from '../models/Conversation';
import Message, { IMessage } from '../models/Message';
import { Types } from 'mongoose';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape attached to the socket after successful JWT handshake */
interface AuthenticatedSocket extends Socket {
  userId: string;
}

/** Payload emitted by the client on the `send_message` event */
interface SendMessagePayload {
  conversationId: string;
  content: string;
  tempId?: string;  // client-generated temp ID for optimistic deduplication
}

/** Payload emitted by the client on `message_delivered` */
interface MessageDeliveredPayload {
  messageId: string;
}

/** Payload emitted by the client on `mark_as_seen` */
interface MarkAsSeenPayload {
  conversationId: string;
}

// ─── JWT Handshake ────────────────────────────────────────────────────────────

/**
 * Socket.io middleware that validates the JWT passed in
 * `socket.handshake.auth.token` (or `Authorization` header).
 *
 * On success  → attaches `socket.userId` and calls `next()`.
 * On failure  → calls `next(new Error('Unauthorized'))` which disconnects.
 */
function jwtHandshake(socket: Socket, next: (err?: Error) => void): void {
  // Support both auth object and Authorization header for flexibility
  const raw: string | undefined =
    socket.handshake.auth?.token ??
    socket.handshake.headers?.authorization;

  const token = raw?.startsWith('Bearer ')
    ? raw.slice(7)
    : raw;

  if (!token) {
    next(new Error('Unauthorized: no token provided'));
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    next(new Error('Server misconfiguration: JWT_SECRET missing'));
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as { id: string };
    (socket as AuthenticatedSocket).userId = decoded.id;
    next();
  } catch {
    next(new Error('Unauthorized: invalid or expired token'));
  }
}

// ─── Socket.io Initializer ────────────────────────────────────────────────────

/**
 * Wraps the existing Express HTTP server with Socket.io.
 * CORS is configured to accept connections from the Vite dev server.
 *
 * ## Events (Server-side)
 *
 * ### `connection`
 * Fired when a socket passes the JWT handshake.
 * Server automatically joins the user to their private room: `socket.join(userId)`.
 *
 * ### `join_room`
 * Payload: `{ conversationId: string }`
 * Client enters a specific conversation view.
 * Server joins the socket to room `conv:<conversationId>`.
 *
 * ### `send_message`
 * Payload: `{ conversationId: string, content: string }`
 * Server:
 *   1. Validates conversationId & membership.
 *   2. Saves Message to MongoDB.
 *   3. Updates Conversation.last_message + updated_at.
 *   4. Emits `receive_message` to the recipient's private room.
 *
 * ### `disconnect`
 * Logged for debugging; Socket.io cleans up rooms automatically.
 */
export function initSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Use WebSockets first, fall back to long-polling if needed
    transports: ['websocket', 'polling'],
  });

  // ── JWT Middleware ───────────────────────────────────────────────────────────
  io.use(jwtHandshake);

  // ── Connection Handler ───────────────────────────────────────────────────────
  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const userId = socket.userId;

    // Join user's private room — used to deliver targeted messages
    socket.join(userId);
    console.log(`🔌 Socket connected: userId=${userId} socketId=${socket.id}`);

    // ── join_room ──────────────────────────────────────────────────────────────
    socket.on('join_room', (payload: { conversationId: string }) => {
      if (!payload?.conversationId) return;
      const roomName = `conv:${payload.conversationId}`;
      socket.join(roomName);
      console.log(`📬 ${userId} joined room ${roomName}`);
    });

    // ── send_message ───────────────────────────────────────────────────────────
    socket.on('send_message', async (payload: SendMessagePayload) => {
      const { conversationId, content, tempId } = payload ?? {};

      // ── Validate inputs ────────────────────────────────────────────────────
      if (
        !conversationId ||
        !content?.trim() ||
        !Types.ObjectId.isValid(conversationId)
      ) {
        socket.emit('error_message', { message: 'Invalid send_message payload.' });
        return;
      }

      const convId = new Types.ObjectId(conversationId);

      try {
        // ── Verify sender is a participant ─────────────────────────────────────
        const conversation = await Conversation.findOne({
          _id: convId,
          participant_ids: new Types.ObjectId(userId),
        }).lean();

        if (!conversation) {
          socket.emit('error_message', { message: 'Not a participant in this conversation.' });
          return;
        }

        // ── Persist message to MongoDB ──────────────────────────────────────────
        const saved: IMessage = await Message.create({
          conversationId: convId,
          senderId: new Types.ObjectId(userId),
          content: content.trim(),
          timestamp: new Date(),
        });

        // ── Update conversation preview ────────────────────────────────────────
        await Conversation.findByIdAndUpdate(convId, {
          last_message: content.trim().slice(0, 100),
          updated_at: new Date(),
        });

        // ── Prepare serialisable payload ──────────────────────────────────────
        // Recipient gets a clean payload (no tempId)
        const recipientPayload = {
          _id: saved._id,
          conversationId: saved.conversationId,
          senderId: userId,
          content: saved.content,
          timestamp: saved.timestamp,
          status: 'sent' as const,
        };

        // Sender gets the same payload + tempId so it can swap the optimistic entry
        const senderPayload = { ...recipientPayload, tempId };

        // ── Deliver to RECIPIENT's private room ────────────────────────────────
        const recipientId = conversation.participant_ids
          .map((id) => id.toString())
          .find((id) => id !== userId);

        if (recipientId) {
          io.to(recipientId).emit('receive_message', recipientPayload);
        }

        // ── Confirm back to SENDER (with tempId for optimistic swap) ──────────
        socket.emit('receive_message', senderPayload);

        console.log(`💬 Message saved: conv=${conversationId} from=${userId}`);
      } catch (err) {
        console.error('❌ send_message error:', err);
        socket.emit('error_message', { message: 'Failed to send message. Please retry.' });
      }
    });

    // ── message_delivered ──────────────────────────────────────────────────────
    // Emitted by the recipient's client as soon as receive_message fires
    socket.on('message_delivered', async (payload: MessageDeliveredPayload) => {
      if (!payload?.messageId || !Types.ObjectId.isValid(payload.messageId)) return;
      try {
        const updated = await Message.findByIdAndUpdate(
          payload.messageId,
          { status: 'delivered' },
          { new: true }
        ).lean();
        if (updated) {
          // Notify the original sender so they can flip 'Sent' → 'Delivered'
          io.to(updated.senderId.toString()).emit('message_status_updated', {
            messageId: payload.messageId,
            status: 'delivered',
          });
        }
      } catch (err) {
        console.error('❌ message_delivered error:', err);
      }
    });

    // ── mark_as_seen ───────────────────────────────────────────────────────────
    // Emitted when the recipient opens (or is already in) the conversation window
    socket.on('mark_as_seen', async (payload: MarkAsSeenPayload) => {
      if (!payload?.conversationId || !Types.ObjectId.isValid(payload.conversationId)) return;
      try {
        // Bulk-mark all unread partner messages as seen
        const result = await Message.updateMany(
          {
            conversationId: new Types.ObjectId(payload.conversationId),
            senderId: { $ne: new Types.ObjectId(userId) },
            status: { $ne: 'seen' },
          },
          { status: 'seen' }
        );
        if (result.modifiedCount > 0) {
          const conv = await Conversation.findById(payload.conversationId).lean();
          if (conv) {
            const partnerId = conv.participant_ids
              .map((id) => id.toString())
              .find((id) => id !== userId);
            if (partnerId) {
              // Notify sender: their last message is now 'Seen'
              io.to(partnerId).emit('message_status_updated', {
                conversationId: payload.conversationId,
                status: 'seen',
              });
            }
          }
        }
      } catch (err) {
        console.error('❌ mark_as_seen error:', err);
      }
    });

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: userId=${userId} reason=${reason}`);
      // Socket.io auto-removes the socket from all rooms on disconnect
    });
  });

  return io;
}
