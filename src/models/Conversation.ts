import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Represents the shape of a Conversation document in MongoDB.
 * Aligns with PROJECT_SPEC.md § 6.3 — Conversations Collection.
 */
export interface IConversation extends Document {
  participant_ids: Types.ObjectId[]; // exactly 2 user IDs (1-to-1 chat)
  last_message:   string;            // preview text for the chat list
  updated_at:     Date;              // used to sort conversations by recency
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const ConversationSchema = new Schema<IConversation>(
  {
    participant_ids: {
      type:     [Schema.Types.ObjectId],
      ref:      'User',
      required: true,
      validate: {
        validator: (v: Types.ObjectId[]) => v.length === 2,
        message:   'A conversation must have exactly 2 participants.',
      },
    },
    last_message: {
      type:    String,
      default: '',
      trim:    true,
      maxlength: [500, 'Last message preview must not exceed 500 characters'],
    },
    updated_at: {
      type:    Date,
      default: () => new Date(),
    },
  },
  {
    // Mongoose timestamps for createdAt; updated_at is explicit (sorted by it)
    timestamps: { createdAt: 'created_at', updatedAt: false },
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Multikey index — covers "find all conversations for a user" queries:
//   db.conversations.find({ participant_ids: userId }).sort({ updated_at: -1 })
ConversationSchema.index({ participant_ids: 1 });

// Sort index — conversations list ordered by most recent activity
ConversationSchema.index({ updated_at: -1 });

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
