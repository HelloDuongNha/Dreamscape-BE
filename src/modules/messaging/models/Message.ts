import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Represents the shape of a Message document in MongoDB.
 * Aligns with PROJECT_SPEC.md § 6.4 — Messages Collection.
 */
export interface IMessage extends Document {
  conversationId: Types.ObjectId; // FK → Conversation._id
  senderId: Types.ObjectId; // FK → User._id
  content: string;
  timestamp: Date;           // explicit field — ISO 8601 equivalent
  status: 'sent' | 'delivered' | 'seen'; // Messenger-style delivery receipt
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'conversationId is required'],
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'senderId is required'],
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      minlength: [1, 'Message cannot be empty'],
      maxlength: [2000, 'Message must not exceed 2000 characters'],
    },
    timestamp: {
      type: Date,
      default: () => new Date(),
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen'],
      default: 'sent',
    },
  },
  {
    // No Mongoose timestamps — timestamp is managed explicitly above
    timestamps: false,
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Compound index — covers chat history queries:
//   db.messages.find({ conversationId }).sort({ timestamp: 1 })
// Leading conversationId covers single-field lookups too.
MessageSchema.index({ conversationId: 1, timestamp: 1 });

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IMessage>('Message', MessageSchema);
