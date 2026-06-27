import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Represents a Comment on a Dream post.
 * Aligns with PROJECT_SPEC.md § 6.5 — Comments Collection.
 */
export interface IComment extends Document {
  dreamId:    Types.ObjectId;  // foreign key → Dream._id
  userId:     Types.ObjectId;  // foreign key → User._id
  content:    string;
  created_at: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CommentSchema = new Schema<IComment>(
  {
    dreamId: {
      type:     Schema.Types.ObjectId,
      ref:      'Dream',
      required: [true, 'dreamId is required'],
      index:    true,
    },
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'userId is required'],
    },
    content: {
      type:      String,
      required:  [true, 'Comment content is required'],
      trim:      true,
      minlength: [1, 'Comment cannot be empty'],
      maxlength: [500, 'Comment must not exceed 500 characters'],
    },
    created_at: {
      type:    Date,
      default: () => new Date(),
    },
  },
  {
    // updatedAt only — created_at is explicit
    timestamps: { createdAt: false, updatedAt: false },
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Covers: db.comments.find({ dreamId }).sort({ created_at: 1 })
CommentSchema.index({ dreamId: 1, created_at: 1 });

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IComment>('Comment', CommentSchema);
